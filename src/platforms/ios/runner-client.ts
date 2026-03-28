import { AppError } from '../../utils/errors.ts';
import { withRetry } from '../../utils/retry.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { ClickButton } from '../../core/click-button.ts';
import { getRequestSignal, createRequestCanceledError, isRequestCanceled } from '../../daemon/request-cancel.ts';
import { bootFailureHint, classifyBootFailure } from '../boot-diagnostics.ts';
import {
  waitForRunner,
  RUNNER_COMMAND_TIMEOUT_MS,
  RUNNER_STARTUP_TIMEOUT_MS,
} from './runner-transport.ts';
import {
  type RunnerSession,
  ensureRunnerSession,
  stopRunnerSession,
  stopIosRunnerSession,
  validateRunnerDevice,
  executeRunnerCommandWithSession,
  parseRunnerResponse,
} from './runner-session.ts';

export type RunnerCommand = {
  command:
    | 'tap'
    | 'mouseClick'
    | 'tapSeries'
    | 'longPress'
    | 'interactionFrame'
    | 'drag'
    | 'dragSeries'
    | 'type'
    | 'swipe'
    | 'findText'
    | 'readText'
    | 'snapshot'
    | 'screenshot'
    | 'back'
    | 'backInApp'
    | 'backSystem'
    | 'home'
    | 'appSwitcher'
    | 'keyboardDismiss'
    | 'alert'
    | 'pinch'
    | 'recordStart'
    | 'recordStop'
    | 'uptime'
    | 'shutdown';
  appBundleId?: string;
  text?: string;
  delayMs?: number;
  action?: 'get' | 'accept' | 'dismiss';
  x?: number;
  y?: number;
  button?: ClickButton;
  count?: number;
  intervalMs?: number;
  doubleTap?: boolean;
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  x2?: number;
  y2?: number;
  durationMs?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  scale?: number;
  outPath?: string;
  fps?: number;
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
  fullscreen?: boolean;
  clearFirst?: boolean;
};

// --- Runner error helpers (merged from runner-errors.ts) ---

export function isRetryableRunnerError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  if (err.code !== 'COMMAND_FAILED') return false;
  const message = `${err.message ?? ''}`.toLowerCase();
  if (message.includes('xcodebuild exited early')) return false;
  if (message.includes('device is busy') && message.includes('connecting')) return false;
  if (message.includes('runner did not accept connection')) return true;
  if (message.includes('fetch failed')) return true;
  if (message.includes('econnrefused')) return true;
  if (message.includes('socket hang up')) return true;
  return false;
}

export function shouldRetryRunnerConnectError(error: unknown): boolean {
  if (!(error instanceof AppError)) return true;
  if (error.code !== 'COMMAND_FAILED') return true;
  const message = String(error.message ?? '').toLowerCase();
  if (message.includes('xcodebuild exited early')) return false;
  return true;
}

export function resolveRunnerEarlyExitHint(
  message: string,
  stdout: string,
  stderr: string,
): string {
  const haystack = `${message}\n${stdout}\n${stderr}`.toLowerCase();
  if (haystack.includes('device is busy') && haystack.includes('connecting')) {
    return 'Target iOS device is still connecting. Keep it unlocked, wait for device trust/connection to settle, then retry.';
  }
  return bootFailureHint('IOS_RUNNER_CONNECT_TIMEOUT');
}

export function buildRunnerConnectError(params: {
  port: number;
  endpoints: string[];
  logPath?: string;
  lastError: unknown;
}): AppError {
  const { port, endpoints, logPath, lastError } = params;
  const message = 'Runner did not accept connection';
  return new AppError('COMMAND_FAILED', message, {
    port,
    endpoints,
    logPath,
    lastError: lastError ? String(lastError) : undefined,
    reason: classifyBootFailure({
      error: lastError,
      message,
      context: { platform: 'ios', phase: 'connect' },
    }),
    hint: bootFailureHint('IOS_RUNNER_CONNECT_TIMEOUT'),
  });
}

export async function buildRunnerEarlyExitError(params: {
  session: RunnerSession;
  port: number;
  logPath?: string;
}): Promise<AppError> {
  const { session, port, logPath } = params;
  const result = await session.testPromise;
  const message = 'Runner did not accept connection (xcodebuild exited early)';
  const reason = classifyBootFailure({
    message,
    stdout: result.stdout,
    stderr: result.stderr,
    context: { platform: 'ios', phase: 'connect' },
  });
  return new AppError('COMMAND_FAILED', message, {
    port,
    logPath,
    xcodebuild: {
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    },
    reason,
    hint: resolveRunnerEarlyExitHint(message, result.stdout, result.stderr),
  });
}

export function resolveSigningFailureHint(error: AppError): string | undefined {
  const details = error.details ? JSON.stringify(error.details) : '';
  const combined = `${error.message}\n${details}`.toLowerCase();
  if (
    combined.includes('failed registering bundle identifier') ||
    (combined.includes('app identifier') && combined.includes('not available'))
  ) {
    return 'Set AGENT_DEVICE_IOS_BUNDLE_ID to a unique reverse-DNS value (for example, com.yourname.agentdevice.runner), then retry.';
  }
  if (combined.includes('requires a development team')) {
    return 'Configure signing in Xcode or set AGENT_DEVICE_IOS_TEAM_ID for physical-device runs.';
  }
  if (combined.includes('no profiles for') || combined.includes('provisioning profile')) {
    return 'Install/select a valid iOS provisioning profile, or set AGENT_DEVICE_IOS_PROVISIONING_PROFILE.';
  }
  if (combined.includes('code signing')) {
    return 'Enable Automatic Signing in Xcode or provide AGENT_DEVICE_IOS_TEAM_ID and optional AGENT_DEVICE_IOS_SIGNING_IDENTITY.';
  }
  return undefined;
}

export function isReadOnlyRunnerCommand(command: RunnerCommand['command']): boolean {
  return (
    command === 'interactionFrame' ||
    command === 'snapshot' ||
    command === 'screenshot' ||
    command === 'findText' ||
    command === 'readText' ||
    command === 'alert' ||
    command === 'uptime'
  );
}

export function assertRunnerRequestActive(requestId: string | undefined): void {
  if (!isRequestCanceled(requestId)) return;
  throw createRequestCanceledError();
}

// --- Runner command execution ---

export async function runIosRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string; requestId?: string } = {},
): Promise<Record<string, unknown>> {
  validateRunnerDevice(device);
  assertRunnerRequestActive(options.requestId);
  if (isReadOnlyRunnerCommand(command.command)) {
    return withRetry(
      () => {
        assertRunnerRequestActive(options.requestId);
        return executeRunnerCommand(device, command, options);
      },
      {
        shouldRetry: (error) => {
          assertRunnerRequestActive(options.requestId);
          return isRetryableRunnerError(error);
        },
      },
    );
  }
  return executeRunnerCommand(device, command, options);
}

async function executeRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string; requestId?: string } = {},
): Promise<Record<string, unknown>> {
  assertRunnerRequestActive(options.requestId);
  const signal = getRequestSignal(options.requestId);
  let session: RunnerSession | undefined;
  try {
    session = await ensureRunnerSession(device, options);
    const timeoutMs = session.ready ? RUNNER_COMMAND_TIMEOUT_MS : RUNNER_STARTUP_TIMEOUT_MS;
    return await executeRunnerCommandWithSession(
      device,
      session,
      command,
      options.logPath,
      timeoutMs,
      signal,
    );
  } catch (err) {
    const appErr = err instanceof AppError ? err : new AppError('COMMAND_FAILED', String(err));
    if (
      appErr.code === 'COMMAND_FAILED' &&
      typeof appErr.message === 'string' &&
      appErr.message.includes('Runner did not accept connection') &&
      shouldRetryRunnerConnectError(appErr) &&
      session?.ready
    ) {
      assertRunnerRequestActive(options.requestId);
      if (session) {
        await stopRunnerSession(session);
      } else {
        await stopIosRunnerSession(device.id);
      }
      session = await ensureRunnerSession(device, options);
      const response = await waitForRunner(
        session.device,
        session.port,
        command,
        options.logPath,
        RUNNER_STARTUP_TIMEOUT_MS,
        undefined,
        signal,
      );
      return await parseRunnerResponse(response, session, options.logPath);
    }
    throw err;
  }
}

// Re-export public API from submodules
export {
  resolveRunnerDestination,
  resolveRunnerBuildDestination,
  resolveRunnerMaxConcurrentDestinationsFlag,
  resolveRunnerSigningBuildSettings,
  resolveRunnerBundleBuildSettings,
  assertSafeDerivedCleanup,
  IOS_RUNNER_CONTAINER_BUNDLE_IDS,
} from './runner-xctestrun.ts';

export {
  getRunnerSessionSnapshot,
  stopIosRunnerSession,
  abortAllIosRunnerSessions,
  stopAllIosRunnerSessions,
} from './runner-session.ts';
