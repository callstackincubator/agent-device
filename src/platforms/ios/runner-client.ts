import { AppError } from '../../utils/errors.ts';
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
  type RunnerCommand,
} from './runner-contract.ts';
import {
  createLocalAppleRunnerProvider,
  hasScopedAppleRunnerProvider,
  resolveAppleRunnerProvider,
  type AppleRunnerCommandOptions,
} from './runner-provider.ts';
import { ensureXctestrun } from './runner-xctestrun.ts';
export {
  isRetryableRunnerError,
  resolveRunnerEarlyExitHint,
  resolveRunnerBuildFailureHint,
  shouldRetryRunnerConnectError,
  type RunnerCommand,
} from './runner-contract.ts';

// --- Runner command execution ---

export async function runIosRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: AppleRunnerCommandOptions = {},
): Promise<Record<string, unknown>> {
  validateRunnerDevice(device);
  assertRunnerRequestActive(options.requestId);
  const provider = resolveAppleRunnerProvider(
    device,
    createLocalAppleRunnerProvider(executeRunnerCommand),
    undefined,
    { requestId: options.requestId },
  );
  if (isReadOnlyRunnerCommand(command.command)) {
    return withRetry(
      () => {
        assertRunnerRequestActive(options.requestId);
        return provider.runCommand(device, command, options);
      },
      {
        shouldRetry: (error) => {
          assertRunnerRequestActive(options.requestId);
          return isRetryableRunnerError(error);
        },
      },
    );
  }
  return provider.runCommand(device, command, options);
}

export function prewarmIosRunnerXctestrun(
  device: DeviceInfo,
  options: RunnerSessionOptions = {},
): Promise<void> | undefined {
  if (device.platform !== 'ios') {
    return undefined;
  }
  if (hasScopedAppleRunnerProvider(device, { requestId: options.requestId })) {
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_runner_xctestrun_prewarm_skipped_scoped_provider',
      data: { deviceId: device.id },
    });
    return undefined;
  }
  const prewarm = ensureXctestrun(device, options)
    .then(() => {})
    .catch((error: unknown) => {
      emitDiagnostic({
        level: 'warn',
        phase: 'ios_runner_xctestrun_prewarm_failed',
        data: {
          deviceId: device.id,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    });
  void prewarm;
  return prewarm;
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
          await invalidateRunnerSession(session, 'transport_error_after_retry_command_send');
        }
        throw retryErr;
      }
    }
    if (!session && appErr.message.includes('Runner did not accept connection')) {
      await stopIosRunnerSession(device.id);
    }
    if (session && isRetryableRunnerError(appErr)) {
      await invalidateRunnerSession(session, 'transport_error_after_command_send');
    }
    throw err;
  }
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
