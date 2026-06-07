import { AppError, toAppErrorCode } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { isReadOnlyRunnerCommand, type RunnerCommand } from './runner-contract.ts';
import type { AppleRunnerCommandOptions } from './runner-provider.ts';
import { executeRunnerCommandWithSession, type RunnerSession } from './runner-session.ts';

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
  invalidateSession: (session: RunnerSession, reason: string) => Promise<void>;
};

const RUNNER_STATUS_RECOVERY_TIMEOUT_MS = 3_000;

export async function handleRunnerTransportErrorAfterCommandSend(params: {
  device: DeviceInfo;
  session: RunnerSession;
  command: RunnerCommand;
  transportError: AppError;
  options: AppleRunnerCommandOptions;
  signal: AbortSignal | undefined;
  invalidationReason: string;
  invalidateSession: (session: RunnerSession, reason: string) => Promise<void>;
}): Promise<Record<string, unknown>> {
  const { device, session, command, transportError, options, signal, invalidationReason } = params;
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
    invalidateSession: params.invalidateSession,
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
  await context.invalidateSession(context.session, context.invalidationReason);
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
