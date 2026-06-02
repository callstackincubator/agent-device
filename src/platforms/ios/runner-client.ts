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

type RunnerTransportRecovery =
  | { type: 'recovered'; data: Record<string, unknown>; reason: string; lifecycleState?: string }
  | { type: 'skipInvalidation'; error: AppError; reason: string; lifecycleState?: string }
  | { type: 'retainInvalidation'; error?: AppError; reason: string; lifecycleState?: string };

type RunnerTransportRecoveryContext = {
  command: RunnerCommand;
  session: RunnerSession;
  transportError: AppError;
  invalidationReason: string;
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
          return await handleRunnerTransportErrorAfterCommandSend(
            device,
            session,
            command,
            retryAppErr,
            options,
            signal,
            'transport_error_after_retry_command_send',
          );
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
          return await handleRunnerTransportErrorAfterCommandSend(
            device,
            session,
            command,
            retryAppErr,
            options,
            signal,
            'transport_error_after_retry_command_send',
          );
        }
        throw retryErr;
      }
    }
    if (!session && appErr.message.includes('Runner did not accept connection')) {
      await stopIosRunnerSession(device.id);
    }
    if (session && isRetryableRunnerError(appErr)) {
      return await handleRunnerTransportErrorAfterCommandSend(
        device,
        session,
        command,
        appErr,
        options,
        signal,
        'transport_error_after_command_send',
      );
    }
    throw err;
  }
}

async function handleRunnerTransportErrorAfterCommandSend(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
  signal: AbortSignal | undefined,
  invalidationReason: string,
): Promise<Record<string, unknown>> {
  const recovery = await tryRecoverRunnerCommandAfterTransportError(
    device,
    session,
    command,
    transportError,
    options,
    signal,
  );
  return await applyRunnerTransportRecovery(recovery, {
    command,
    session,
    transportError,
    invalidationReason,
  });
}

async function applyRunnerTransportRecovery(
  recovery: RunnerTransportRecovery | undefined,
  context: RunnerTransportRecoveryContext,
): Promise<Record<string, unknown>> {
  if (!recovery) return await retainRunnerInvalidation(context, 'status_recovery_unavailable');
  if (recovery.type === 'recovered') return recoverRunnerResponse(recovery, context);
  if (recovery.type === 'skipInvalidation') throw skipRunnerInvalidation(recovery, context);
  return await retainRunnerInvalidation(
    context,
    recovery.reason,
    recovery.lifecycleState,
    recovery.error,
  );
}

function recoverRunnerResponse(
  recovery: Extract<RunnerTransportRecovery, { type: 'recovered' }>,
  context: RunnerTransportRecoveryContext,
): Record<string, unknown> {
  emitRunnerInvalidationDecision({
    command: context.command,
    session: context.session,
    transportError: context.transportError,
    decision: 'skipped',
    reason: recovery.reason,
    lifecycleState: recovery.lifecycleState,
  });
  return recovery.data;
}

function skipRunnerInvalidation(
  recovery: Extract<RunnerTransportRecovery, { type: 'skipInvalidation' }>,
  context: RunnerTransportRecoveryContext,
): AppError {
  emitRunnerInvalidationDecision({
    command: context.command,
    session: context.session,
    transportError: context.transportError,
    decision: 'skipped',
    reason: recovery.reason,
    lifecycleState: recovery.lifecycleState,
  });
  return recovery.error;
}

async function retainRunnerInvalidation(
  context: RunnerTransportRecoveryContext,
  reason: string,
  lifecycleState?: string,
  error?: AppError,
): Promise<never> {
  emitRunnerInvalidationDecision({
    command: context.command,
    session: context.session,
    transportError: context.transportError,
    decision: 'retained',
    reason,
    lifecycleState,
  });
  await invalidateRunnerSession(context.session, context.invalidationReason);
  throw error ?? context.transportError;
}

async function tryRecoverRunnerCommandAfterTransportError(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
  signal?: AbortSignal,
): Promise<RunnerTransportRecovery | undefined> {
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
    return { type: 'retainInvalidation', reason: 'status_probe_failed' };
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
  return handleRunnerCommandStatusRecovery(
    status,
    lifecycleState,
    command,
    transportError,
    options,
  );
}

function handleRunnerCommandStatusRecovery(
  status: Record<string, unknown>,
  lifecycleState: string,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
): RunnerTransportRecovery | undefined {
  if (lifecycleState === 'completed') {
    return handleCompletedRunnerStatus(status, command, transportError, options);
  }

  if (lifecycleState === 'failed') {
    return {
      type: 'skipInvalidation',
      reason: 'runner_reported_failure',
      lifecycleState,
      error: runnerStatusFailureError(status, command, transportError, options),
    };
  }

  if (lifecycleState === 'accepted' || lifecycleState === 'started') {
    return {
      type: 'skipInvalidation',
      reason: 'command_still_in_flight',
      lifecycleState,
      error: runnerStatusInFlightError(lifecycleState, command, transportError, options),
    };
  }

  return {
    type: 'retainInvalidation',
    reason: lifecycleState ? 'unknown_lifecycle_state' : 'missing_lifecycle_state',
    lifecycleState,
    error: new AppError(
      'COMMAND_FAILED',
      `Runner command "${command.command}" lost its transport response and lifecycle status was ${lifecycleState ? `"${lifecycleState}"` : 'missing'}, so agent-device invalidated the runner session instead of replaying the command.`,
      {
        command: command.command,
        commandId: command.commandId,
        lifecycleState,
        recovery: 'lifecycle_state_not_recoverable',
        hint: unknownLifecycleStateHint(command.command),
        logPath: options.logPath,
        transportError: transportError.message,
      },
      transportError,
    ),
  };
}

function handleCompletedRunnerStatus(
  status: Record<string, unknown>,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
): RunnerTransportRecovery {
  const recovered = parseLifecycleResponseJson(status.lifecycleResponseJson);
  if (recovered) {
    return {
      type: 'recovered',
      data: recovered,
      reason: 'completed_with_retained_response',
      lifecycleState: 'completed',
    };
  }
  if (isReadOnlyRunnerCommand(command.command)) {
    return {
      type: 'skipInvalidation',
      error: transportError,
      reason: 'read_only_completed_without_retained_response',
      lifecycleState: 'completed',
    };
  }
  return {
    type: 'skipInvalidation',
    reason: 'completed_without_retained_response',
    lifecycleState: 'completed',
    error: new AppError(
      'COMMAND_FAILED',
      `Runner command "${command.command}" completed after the transport response was lost, but no recoverable response was retained.`,
      {
        command: command.command,
        commandId: command.commandId,
        lifecycleState: 'completed',
        recovery: 'completed_without_retained_response',
        hint: completedWithoutRetainedResponseHint(command.command),
        logPath: options.logPath,
        transportError: transportError.message,
      },
      transportError,
    ),
  };
}

function runnerStatusFailureError(
  status: Record<string, unknown>,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
): AppError {
  const errorCode =
    typeof status.lifecycleErrorCode === 'string' ? status.lifecycleErrorCode : undefined;
  const errorMessage =
    typeof status.lifecycleErrorMessage === 'string'
      ? status.lifecycleErrorMessage
      : 'Runner command failed';
  const hint =
    typeof status.lifecycleErrorHint === 'string' ? status.lifecycleErrorHint : undefined;
  return new AppError(
    toAppErrorCode(errorCode),
    errorMessage,
    {
      command: command.command,
      commandId: command.commandId,
      lifecycleState: 'failed',
      recovery: 'runner_reported_failure',
      hint: hint ?? runnerReportedFailureHint(command.command),
      logPath: options.logPath,
      transportError: transportError.message,
    },
    transportError,
  );
}

function runnerStatusInFlightError(
  lifecycleState: string,
  command: RunnerCommand,
  transportError: AppError,
  options: AppleRunnerCommandOptions,
): AppError {
  if (isReadOnlyRunnerCommand(command.command)) {
    return transportError;
  }
  return new AppError(
    'COMMAND_FAILED',
    `Runner command "${command.command}" is still ${lifecycleState} after the transport response was lost.`,
    {
      command: command.command,
      commandId: command.commandId,
      lifecycleState,
      recovery: 'command_still_in_flight',
      hint: inFlightAfterLostResponseHint(command.command, lifecycleState),
      logPath: options.logPath,
      transportError: transportError.message,
    },
    transportError,
  );
}

function parseLifecycleResponseJson(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = parseLifecycleResponsePayload(value);
  if (!parsed.ok) return undefined;
  if (parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
    return parsed.data as Record<string, unknown>;
  }
  return {};
}

function parseLifecycleResponsePayload(value: string): LifecycleResponsePayload {
  try {
    const raw: unknown = JSON.parse(value);
    if (raw && typeof raw === 'object') return raw as LifecycleResponsePayload;
  } catch {}
  return {};
}

function completedWithoutRetainedResponseHint(command: string): string {
  return `The runner is still reachable and reports "${command}" already completed, so agent-device kept the session open and will not replay it. Run snapshot -i to inspect the current UI, then continue from that observed state.`;
}

function runnerReportedFailureHint(command: string): string {
  return `The runner is still reachable and reports "${command}" failed after the transport response was lost, so agent-device kept the session open and did not replay it. Run snapshot -i to inspect the current UI and retry with a selector visible in that snapshot.`;
}

function inFlightAfterLostResponseHint(command: string, lifecycleState: string): string {
  return `The runner is still reachable and reports "${command}" is ${lifecycleState}, so agent-device kept the session open and will not replay it. Wait briefly, run snapshot -i to inspect the current UI, then continue from that observed state.`;
}

function unknownLifecycleStateHint(command: string): string {
  return `The runner did not confirm that "${command}" reached a safe terminal state, so agent-device kept the conservative invalidation path. Run snapshot -i before retrying if the UI may have changed.`;
}

function emitRunnerInvalidationDecision(params: {
  command: RunnerCommand;
  session: RunnerSession;
  transportError: AppError;
  decision: 'skipped' | 'retained';
  reason: string;
  lifecycleState?: string;
}): void {
  const { command, session, transportError, decision, reason, lifecycleState } = params;
  emitDiagnostic({
    level: decision === 'retained' ? 'warn' : 'debug',
    phase: 'ios_runner_command_invalidation_decision',
    data: {
      command: command.command,
      commandId: command.commandId,
      decision,
      reason,
      lifecycleState,
      runnerReachable: lifecycleState !== undefined,
      sessionId: session.sessionId,
      transportError: transportError.message,
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
