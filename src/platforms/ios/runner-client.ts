import { AppError, toAppErrorCode } from '../../utils/errors.ts';
import { withRetry } from '../../utils/retry.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { getRequestSignal } from '../../daemon/request-cancel.ts';
import { RUNNER_COMMAND_TIMEOUT_MS, RUNNER_STARTUP_TIMEOUT_MS } from './runner-transport.ts';
import {
  type RunnerSessionOptions,
  type RunnerSession,
  ensureRunnerSession,
  invalidateRunnerSession,
  stopIosRunnerSession,
  validateRunnerDevice,
  executeRunnerCommandWithSession,
} from './runner-session.ts';
import {
  assertRunnerRequestActive,
  isReadOnlyRunnerCommand,
  isRetryableRunnerError,
  shouldRetryRunnerConnectError,
  withRunnerCommandId,
  type RunnerCommand,
} from './runner-contract.ts';
import {
  createLocalAppleRunnerProvider,
  hasScopedAppleRunnerProvider,
  resolveAppleRunnerProvider,
  type AppleRunnerCommandOptions,
} from './runner-provider.ts';
export {
  isRetryableRunnerError,
  resolveRunnerEarlyExitHint,
  resolveRunnerBuildFailureHint,
  shouldRetryRunnerConnectError,
  type RunnerCommand,
} from './runner-contract.ts';

type LifecycleResponsePayload = {
  ok?: unknown;
  data?: unknown;
};

const RUNNER_STATUS_RECOVERY_TIMEOUT_MS = 3_000;

// --- Runner command execution ---

export async function runIosRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: AppleRunnerCommandOptions = {},
): Promise<Record<string, unknown>> {
  validateRunnerDevice(device);
  assertRunnerRequestActive(options.requestId);
  const runnerCommand = withRunnerCommandId(command);
  const provider = resolveAppleRunnerProvider(
    device,
    createLocalAppleRunnerProvider(executeRunnerCommand),
    undefined,
    { requestId: options.requestId },
  );
  if (isReadOnlyRunnerCommand(runnerCommand.command)) {
    return withRetry(
      () => {
        assertRunnerRequestActive(options.requestId);
        return provider.runCommand(device, runnerCommand, options);
      },
      {
        shouldRetry: (error) => {
          assertRunnerRequestActive(options.requestId);
          return isRetryableRunnerError(error);
        },
      },
    );
  }
  return provider.runCommand(device, runnerCommand, options);
}

export function prewarmIosRunnerSession(
  device: DeviceInfo,
  options: RunnerSessionOptions = {},
): Promise<void> | undefined {
  if (device.platform !== 'ios') {
    return undefined;
  }
  if (hasScopedAppleRunnerProvider(device, { requestId: options.requestId })) {
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_runner_session_prewarm_skipped_scoped_provider',
      data: { deviceId: device.id },
    });
    return undefined;
  }
  const prewarm = ensureRunnerSession(device, options)
    .then(() => {})
    .catch((error: unknown) => {
      emitDiagnostic({
        level: 'warn',
        phase: 'ios_runner_session_prewarm_failed',
        data: {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  void prewarm;
  return prewarm;
}

// fallow-ignore-next-line complexity
async function executeRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: AppleRunnerCommandOptions,
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
      session
    ) {
      assertRunnerRequestActive(options.requestId);
      await invalidateRunnerSession(session, 'runner_connect_failed_before_command_send');
      session = await ensureRunnerSession(device, { ...options, cleanStaleBundles: true });
      try {
        return await executeRunnerCommandWithSession(
          device,
          session,
          command,
          options.logPath,
          RUNNER_STARTUP_TIMEOUT_MS,
          signal,
        );
      } catch (retryErr) {
        const retryAppErr =
          retryErr instanceof AppError
            ? retryErr
            : new AppError('COMMAND_FAILED', String(retryErr));
        if (isRetryableRunnerError(retryAppErr)) {
          const recovered = await tryRecoverRunnerCommandAfterTransportError(
            device,
            session,
            command,
            retryAppErr,
            options,
            signal,
          );
          if (recovered) return recovered;
          await invalidateRunnerSession(session, 'transport_error_after_retry_command_send');
        }
        throw retryErr;
      }
    }
    if (session && shouldRestartAfterReadinessPreflightError(appErr)) {
      assertRunnerRequestActive(options.requestId);
      await invalidateRunnerSession(
        session,
        'runner_readiness_preflight_failed_before_command_send',
      );
      session = await ensureRunnerSession(device, { ...options, cleanStaleBundles: true });
      try {
        return await executeRunnerCommandWithSession(
          device,
          session,
          command,
          options.logPath,
          RUNNER_STARTUP_TIMEOUT_MS,
          signal,
        );
      } catch (retryErr) {
        const retryAppErr =
          retryErr instanceof AppError
            ? retryErr
            : new AppError('COMMAND_FAILED', String(retryErr));
        if (isRetryableRunnerError(retryAppErr)) {
          const recovered = await tryRecoverRunnerCommandAfterTransportError(
            device,
            session,
            command,
            retryAppErr,
            options,
            signal,
          );
          if (recovered) return recovered;
          await invalidateRunnerSession(session, 'transport_error_after_retry_command_send');
        }
        throw retryErr;
      }
    }
    if (!session && appErr.message.includes('Runner did not accept connection')) {
      await stopIosRunnerSession(device.id);
    }
    if (session && isRetryableRunnerError(appErr)) {
      const recovered = await tryRecoverRunnerCommandAfterTransportError(
        device,
        session,
        command,
        appErr,
        options,
        signal,
      );
      if (recovered) return recovered;
      await invalidateRunnerSession(session, 'transport_error_after_command_send');
    }
    throw err;
  }
}

async function tryRecoverRunnerCommandAfterTransportError(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
  if (command.command === 'status' || !command.commandId?.trim()) return undefined;
  let status: Record<string, unknown>;
  try {
    status = await executeRunnerCommandWithSession(
      device,
      session,
      { command: 'status', statusCommandId: command.commandId },
      options.logPath,
      RUNNER_STATUS_RECOVERY_TIMEOUT_MS,
      signal,
    );
  } catch (error) {
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_runner_command_status_recovery_failed',
      data: {
        command: command.command,
        commandId: command.commandId,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return undefined;
  }

  const lifecycleState = typeof status.lifecycleState === 'string' ? status.lifecycleState : '';
  emitDiagnostic({
    level: 'debug',
    phase: 'ios_runner_command_status_recovery',
    data: {
      command: command.command,
      commandId: command.commandId,
      lifecycleState,
    },
  });

  if (lifecycleState === 'completed') {
    const recovered = parseLifecycleResponseJson(status.lifecycleResponseJson);
    if (recovered) return recovered;
    if (isReadOnlyRunnerCommand(command.command)) {
      throw transportError;
    }
    throw new AppError(
      'COMMAND_FAILED',
      `Runner command "${command.command}" completed after the transport response was lost, but no recoverable response was retained.`,
      {
        command: command.command,
        commandId: command.commandId,
        lifecycleState,
        recovery: 'completed_without_retained_response',
        hint: completedWithoutRetainedResponseHint(command.command),
        logPath: options.logPath,
        transportError: transportError.message,
      },
      transportError,
    );
  }

  if (lifecycleState === 'failed') {
    const errorCode =
      typeof status.lifecycleErrorCode === 'string' ? status.lifecycleErrorCode : undefined;
    const errorMessage =
      typeof status.lifecycleErrorMessage === 'string'
        ? status.lifecycleErrorMessage
        : 'Runner command failed';
    const hint =
      typeof status.lifecycleErrorHint === 'string' ? status.lifecycleErrorHint : undefined;
    throw new AppError(
      toAppErrorCode(errorCode),
      errorMessage,
      {
        command: command.command,
        commandId: command.commandId,
        lifecycleState,
        recovery: 'runner_reported_failure',
        hint: hint ?? runnerReportedFailureHint(command.command),
        logPath: options.logPath,
        transportError: transportError.message,
      },
      transportError,
    );
  }

  if (lifecycleState === 'accepted' || lifecycleState === 'started') {
    throw new AppError(
      'COMMAND_FAILED',
      `Runner command "${command.command}" is still ${lifecycleState} after the transport response was lost.`,
      {
        command: command.command,
        commandId: command.commandId,
        lifecycleState,
        recovery: 'command_still_in_flight',
        hint: inFlightAfterLostResponseHint(command.command),
        logPath: options.logPath,
        transportError: transportError.message,
      },
      transportError,
    );
  }

  return undefined;
}

function parseLifecycleResponseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  let parsed: LifecycleResponsePayload;
  try {
    const raw: unknown = JSON.parse(value);
    parsed = raw && typeof raw === 'object' ? (raw as LifecycleResponsePayload) : {};
  } catch {
    return undefined;
  }
  if (!parsed.ok) return undefined;
  if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
    return parsed.data as Record<string, unknown>;
  }
  return {};
}

function completedWithoutRetainedResponseHint(command: string): string {
  return `The runner reports "${command}" already completed, so agent-device will not replay it. Run snapshot -i to inspect the current UI, then continue from that observed state. If the session is stale, close and reopen the session before retrying.`;
}

function runnerReportedFailureHint(command: string): string {
  return `The runner observed "${command}" fail after the transport response was lost, so agent-device did not replay it. Run snapshot -i to inspect the current UI and retry with a selector visible in that snapshot. If the session is stale, close and reopen the session before retrying.`;
}

function inFlightAfterLostResponseHint(command: string): string {
  return `The runner has accepted "${command}" and it may still finish, so agent-device will not replay it. Wait briefly, run snapshot -i to inspect the current UI, then continue from that observed state. If the session stops responding, close and reopen the session before retrying.`;
}

function isRunnerReadinessPreflightError(error: AppError): boolean {
  return error.details?.runnerReadinessPreflightFailed === true;
}

function shouldRestartAfterReadinessPreflightError(error: AppError): boolean {
  return (
    isRunnerReadinessPreflightError(error) &&
    (isRetryableRunnerError(error) || isRunnerReadinessPreflightTimeout(error))
  );
}

function isRunnerReadinessPreflightTimeout(error: AppError): boolean {
  const message = error.message.toLowerCase();
  return message.includes('timeout') || message.includes('timed out');
}

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
