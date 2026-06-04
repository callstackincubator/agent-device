import { AppError } from '../../utils/errors.ts';
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
  executeRunnerCommandWithSession,
  readRunnerStartupTimeoutMs,
} from './runner-session.ts';
import {
  assertRunnerRequestActive,
  isRetryableRunnerError,
  shouldRetryRunnerConnectError,
  withRunnerCommandId,
  type RunnerCommand,
} from './runner-contract.ts';
import type { AppleRunnerCommandOptions } from './runner-provider.ts';
import {
  markRunnerXctestrunArtifactBadForRun,
  type RunnerXctestrunArtifact,
} from './runner-xctestrun.ts';
import { handleRunnerTransportErrorAfterCommandSend } from './runner-command-recovery.ts';

export type PrepareIosRunnerOptions = RunnerSessionOptions & {
  healthTimeoutMs: number;
};

export type PrepareIosRunnerResult = {
  runner: Record<string, unknown>;
  cache?: RunnerXctestrunArtifact['cache'];
  artifact?: RunnerXctestrunArtifact['artifact'];
  buildMs?: number;
  connectMs: number;
  healthCheckMs: number;
  xctestrunPath?: string;
  failureReason?: string;
};

export async function prepareLocalIosRunner(
  device: DeviceInfo,
  options: PrepareIosRunnerOptions,
): Promise<PrepareIosRunnerResult> {
  assertRunnerRequestActive(options.requestId);
  const signal = getRequestSignal(options.requestId);
  const command = withRunnerCommandId({ command: 'uptime' });
  let session: RunnerSession | undefined;
  try {
    const connectStartedAt = Date.now();
    session = await ensureRunnerSession(device, options);
    const connectMs = Date.now() - connectStartedAt;
    return await runPrepareHealthCheck(device, session, command, options, signal, connectMs);
  } catch (err) {
    const appErr = err instanceof AppError ? err : new AppError('COMMAND_FAILED', String(err));
    if (!session || !shouldRecoverBadCachedRunnerArtifact(appErr, session)) {
      throw err;
    }
    const reason = appErr.message || 'runner_health_failed';
    await invalidateRunnerSession(session, 'prepare_cached_runner_health_failed');
    await markRunnerXctestrunArtifactBadForRun(session.xctestrunArtifact, reason);
    const connectStartedAt = Date.now();
    const rebuiltSession = await ensureRunnerSession(device, {
      ...options,
      cleanStaleBundles: true,
      forceRunnerXctestrunRebuild: true,
    });
    const connectMs = Date.now() - connectStartedAt;
    try {
      const recovered = await runPrepareHealthCheck(
        device,
        rebuiltSession,
        command,
        options,
        signal,
        connectMs,
        reason,
      );
      emitDiagnostic({
        level: 'info',
        phase: 'ios_runner_prepare_bad_cache_recovered',
        data: {
          command: command.command,
          commandId: command.commandId,
          sessionId: rebuiltSession.sessionId,
          xctestrunPath: rebuiltSession.xctestrunArtifact?.xctestrunPath,
          reason,
        },
      });
      return recovered;
    } catch (retryErr) {
      await invalidateRunnerSession(rebuiltSession, 'prepare_rebuilt_runner_health_failed');
      throw wrapPrepareHealthFailure(retryErr, rebuiltSession, reason);
    }
  }
}

// fallow-ignore-next-line complexity
export async function executeRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: AppleRunnerCommandOptions,
): Promise<Record<string, unknown>> {
  assertRunnerRequestActive(options.requestId);
  const signal = getRequestSignal(options.requestId);
  let session: RunnerSession | undefined;
  try {
    session = await ensureRunnerSession(device, options);
    const timeoutMs = session.ready
      ? RUNNER_COMMAND_TIMEOUT_MS
      : readRunnerStartupTimeoutMs(session);
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
          return await handleRunnerTransportErrorAfterCommandSend({
            device,
            session,
            command,
            transportError: retryAppErr,
            options,
            signal,
            invalidationReason: 'transport_error_after_retry_command_send',
            invalidateSession: invalidateRunnerSession,
          });
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
        const recovered = await executeRunnerCommandWithSession(
          device,
          session,
          command,
          options.logPath,
          RUNNER_STARTUP_TIMEOUT_MS,
          signal,
        );
        emitDiagnostic({
          level: 'debug',
          phase: 'ios_runner_readiness_preflight_recovered',
          data: {
            command: command.command,
            commandId: command.commandId,
            recovery: 'session_restarted',
            sessionId: session.sessionId,
          },
        });
        return recovered;
      } catch (retryErr) {
        const retryAppErr =
          retryErr instanceof AppError
            ? retryErr
            : new AppError('COMMAND_FAILED', String(retryErr));
        if (isRetryableRunnerError(retryAppErr)) {
          return await handleRunnerTransportErrorAfterCommandSend({
            device,
            session,
            command,
            transportError: retryAppErr,
            options,
            signal,
            invalidationReason: 'transport_error_after_retry_command_send',
            invalidateSession: invalidateRunnerSession,
          });
        }
        throw retryErr;
      }
    }
    if (!session && appErr.message.includes('Runner did not accept connection')) {
      await stopIosRunnerSession(device.id);
    }
    if (session && isRetryableRunnerError(appErr)) {
      return await handleRunnerTransportErrorAfterCommandSend({
        device,
        session,
        command,
        transportError: appErr,
        options,
        signal,
        invalidationReason: 'transport_error_after_command_send',
        invalidateSession: invalidateRunnerSession,
      });
    }
    throw err;
  }
}

async function runPrepareHealthCheck(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  options: PrepareIosRunnerOptions,
  signal: AbortSignal | undefined,
  connectMs: number,
  failureReason?: string,
): Promise<PrepareIosRunnerResult> {
  const healthStartedAt = Date.now();
  const runner = await executeRunnerCommandWithSession(
    device,
    session,
    command,
    options.logPath,
    options.healthTimeoutMs,
    signal,
  );
  return buildPrepareIosRunnerResult(
    runner,
    session,
    connectMs,
    Date.now() - healthStartedAt,
    failureReason,
  );
}

function shouldRecoverBadCachedRunnerArtifact(
  error: AppError,
  session: RunnerSession,
): session is RunnerSession & {
  xctestrunArtifact: NonNullable<RunnerSession['xctestrunArtifact']>;
} {
  const artifact = session.xctestrunArtifact;
  if (!artifact || artifact.cache === 'miss') return false;
  return (
    isRetryableRunnerError(error) ||
    shouldRetryRunnerConnectError(error) ||
    isPrepareHealthTimeout(error)
  );
}

function isPrepareHealthTimeout(error: AppError): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('timeout') || message.includes('timed out') || message.includes('deadline')
  );
}

function wrapPrepareHealthFailure(
  error: unknown,
  session: RunnerSession,
  restoredFailureReason: string,
): AppError {
  const appErr = error instanceof AppError ? error : new AppError('COMMAND_FAILED', String(error));
  return new AppError(
    appErr.code,
    'artifact restored but runner did not connect',
    {
      ...(appErr.details ?? {}),
      restoredFailureReason,
      xctestrunPath: session.xctestrunArtifact?.xctestrunPath,
      artifact: session.xctestrunArtifact?.artifact,
      cache: session.xctestrunArtifact?.cache,
      reason: appErr.message,
    },
    appErr,
  );
}

function buildPrepareIosRunnerResult(
  runner: Record<string, unknown>,
  session: RunnerSession,
  connectMs: number,
  healthCheckMs: number,
  failureReason: string | undefined,
): PrepareIosRunnerResult {
  const artifact = session.xctestrunArtifact;
  if (!artifact) {
    return {
      runner,
      connectMs: Math.max(0, connectMs),
      healthCheckMs: Math.max(0, healthCheckMs),
      ...(failureReason ? { failureReason } : {}),
    };
  }
  return {
    runner,
    cache: artifact.cache,
    artifact: artifact.artifact,
    buildMs: artifact.buildMs,
    connectMs: Math.max(0, connectMs),
    healthCheckMs: Math.max(0, healthCheckMs),
    xctestrunPath: artifact.xctestrunPath,
    ...(failureReason ? { failureReason } : {}),
  };
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
