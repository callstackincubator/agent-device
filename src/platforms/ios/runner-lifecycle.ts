import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { getRequestSignal } from '../../daemon/request-cancel.ts';
import { RUNNER_COMMAND_TIMEOUT_MS, RUNNER_STARTUP_TIMEOUT_MS } from './runner-transport.ts';
import {
  type RunnerSession,
  ensureRunnerSession,
  invalidateRunnerSession,
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
import type {
  AppleRunnerCommandOptions,
  AppleRunnerPrepareOptions,
  AppleRunnerPrepareResult,
} from './runner-provider.ts';
import { markRunnerXctestrunArtifactBadForRun } from './runner-xctestrun.ts';
import { handleRunnerTransportErrorAfterCommandSend } from './runner-command-recovery.ts';

export type PrepareIosRunnerOptions = AppleRunnerPrepareOptions;
export type PrepareIosRunnerResult = AppleRunnerPrepareResult;

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
    return recordPrepareResult(
      device,
      await runPrepareHealthCheck(device, session, command, options, signal, connectMs),
    );
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
        { recoveryReason: reason },
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
      return recordPrepareResult(device, recovered);
    } catch (retryErr) {
      await invalidateRunnerSession(rebuiltSession, 'prepare_rebuilt_runner_health_failed');
      const wrapped = wrapPrepareHealthFailure(retryErr, rebuiltSession, reason);
      emitPrepareDiagnostic(device, {
        cache: rebuiltSession.xctestrunArtifact?.cache,
        artifact: rebuiltSession.xctestrunArtifact?.artifact,
        buildMs: rebuiltSession.xctestrunArtifact?.buildMs,
        connectMs,
        healthCheckMs: 0,
        xctestrunPath: rebuiltSession.xctestrunArtifact?.xctestrunPath,
        failureReason: wrapped.message,
      });
      throw wrapped;
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
      return await restartSessionAndRunCommand({
        device,
        session,
        command,
        options,
        signal,
        restartReason: 'runner_connect_failed_before_command_send',
      });
    }
    if (session && shouldRestartAfterReadinessPreflightError(appErr)) {
      assertRunnerRequestActive(options.requestId);
      return await restartSessionAndRunCommand({
        device,
        session,
        command,
        options,
        signal,
        restartReason: 'runner_readiness_preflight_failed_before_command_send',
        recoveredDiagnosticPhase: 'ios_runner_readiness_preflight_recovered',
      });
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

async function restartSessionAndRunCommand(params: {
  device: DeviceInfo;
  session: RunnerSession;
  command: RunnerCommand;
  options: AppleRunnerCommandOptions;
  signal: AbortSignal | undefined;
  restartReason:
    | 'runner_connect_failed_before_command_send'
    | 'runner_readiness_preflight_failed_before_command_send';
  recoveredDiagnosticPhase?: string;
}): Promise<Record<string, unknown>> {
  const { device, command, options, signal, restartReason } = params;
  await invalidateRunnerSession(params.session, restartReason);
  const restartedSession = await ensureRunnerSession(device, {
    ...options,
    cleanStaleBundles: true,
  });
  try {
    const recovered = await executeRunnerCommandWithSession(
      device,
      restartedSession,
      command,
      options.logPath,
      RUNNER_STARTUP_TIMEOUT_MS,
      signal,
    );
    if (params.recoveredDiagnosticPhase) {
      emitDiagnostic({
        level: 'debug',
        phase: params.recoveredDiagnosticPhase,
        data: {
          command: command.command,
          commandId: command.commandId,
          recovery: 'session_restarted',
          sessionId: restartedSession.sessionId,
        },
      });
    }
    return recovered;
  } catch (retryErr) {
    const retryAppErr =
      retryErr instanceof AppError ? retryErr : new AppError('COMMAND_FAILED', String(retryErr));
    if (isRetryableRunnerError(retryAppErr)) {
      return await handleRunnerTransportErrorAfterCommandSend({
        device,
        session: restartedSession,
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

async function runPrepareHealthCheck(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  options: PrepareIosRunnerOptions,
  signal: AbortSignal | undefined,
  connectMs: number,
  reason?: { recoveryReason?: string; failureReason?: string },
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
    reason,
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
  reason: { recoveryReason?: string; failureReason?: string } | undefined,
): PrepareIosRunnerResult {
  const artifact = session.xctestrunArtifact;
  const reasonFields = {
    ...(reason?.recoveryReason ? { recoveryReason: reason.recoveryReason } : {}),
    ...(reason?.failureReason ? { failureReason: reason.failureReason } : {}),
  };
  if (!artifact) {
    return {
      runner,
      connectMs: Math.max(0, connectMs),
      healthCheckMs: Math.max(0, healthCheckMs),
      ...reasonFields,
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
    ...reasonFields,
  };
}

function recordPrepareResult(
  device: DeviceInfo,
  result: PrepareIosRunnerResult,
): PrepareIosRunnerResult {
  emitPrepareDiagnostic(device, result);
  return result;
}

function emitPrepareDiagnostic(
  device: DeviceInfo,
  result: Omit<PrepareIosRunnerResult, 'runner'>,
): void {
  emitDiagnostic({
    level: result.failureReason ? 'warn' : 'info',
    phase: 'apple_runner_prepare',
    data: {
      platform: device.platform,
      target: device.target,
      deviceId: device.id,
      cache: result.cache,
      artifact: result.artifact,
      buildMs: result.buildMs,
      connectMs: result.connectMs,
      healthCheckMs: result.healthCheckMs,
      xctestrunPath: result.xctestrunPath,
      recoveryReason: result.recoveryReason,
      failureReason: result.failureReason,
    },
  });
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
