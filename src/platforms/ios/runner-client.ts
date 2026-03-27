import { AppError } from '../../utils/errors.ts';
import { withRetry } from '../../utils/retry.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { ClickButton } from '../../core/click-button.ts';
import { getRequestSignal } from '../../daemon/request-cancel.ts';
import {
  isRetryableRunnerError,
  shouldRetryRunnerConnectError,
  isReadOnlyRunnerCommand,
  assertRunnerRequestActive,
} from './runner-errors.ts';
import {
  waitForRunner,
  RUNNER_COMMAND_TIMEOUT_MS,
  RUNNER_STARTUP_TIMEOUT_MS,
} from './runner-transport.ts';
import {
  type RunnerSession,
  ensureRunnerSession,
  getRunnerSessionSnapshot,
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
  clearFirst?: boolean;
};

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
  isRetryableRunnerError,
  shouldRetryRunnerConnectError,
  resolveRunnerEarlyExitHint,
} from './runner-errors.ts';

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
