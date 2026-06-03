import { AppError, toAppErrorCode } from '../../utils/errors.ts';
import { runCmdBackground, type ExecResult, type ExecBackgroundResult } from '../../utils/exec.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { Deadline } from '../../utils/retry.ts';
import { isProcessAlive, isProcessGroupAlive } from '../../utils/process-identity.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../../utils/diagnostics.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';
import { runAppleToolCommand, runXcrun } from './tool-provider.ts';
import {
  waitForRunner,
  sendRunnerCommandOnce,
  getFreePort,
  logChunk,
  cleanupTempFile,
  RUNNER_STARTUP_TIMEOUT_MS,
  RUNNER_DESTINATION_TIMEOUT_SECONDS,
} from './runner-transport.ts';
import {
  acquireXcodebuildSimulatorSetRedirect,
  ensureXctestrun,
  IOS_RUNNER_CONTAINER_BUNDLE_IDS,
  prepareXctestrunWithEnv,
  resolveRunnerDestination,
  resolveRunnerMaxConcurrentDestinationsFlag,
  runnerPrepProcesses,
} from './runner-xctestrun.ts';
import {
  isReadOnlyRunnerCommand,
  withRunnerCommandId,
  type RunnerCommand,
} from './runner-contract.ts';
import type { RunnerSession } from './runner-session-types.ts';

export type { RunnerSession } from './runner-session-types.ts';

export type RunnerSessionOptions = {
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  cleanStaleBundles?: boolean;
  requestId?: string;
};

const runnerSessions = new Map<string, RunnerSession>();
const runnerSessionLocks = new Map<string, Promise<unknown>>();
const RUNNER_STOP_WAIT_TIMEOUT_MS = 10_000;
const RUNNER_INVALIDATE_WAIT_TIMEOUT_MS = 1_000;
const RUNNER_READY_PREFLIGHT_TIMEOUT_MS = 5_000;
const RUNNER_TAP_PREFLIGHT_SKIP_FRESHNESS_MS = 10_000;
const RUNNER_SHUTDOWN_TIMEOUT_MS = 15_000;

type RunnerReadinessPreflightDecision =
  | {
      action: 'run';
      reason:
        | 'startup'
        | 'conservative_command'
        | 'no_successful_response'
        | 'successful_response_stale';
      lastSuccessfulRunnerResponseAgeMs?: number;
    }
  | {
      action: 'skip';
      reason: 'recent_successful_response';
      lastSuccessfulRunnerResponseAgeMs: number;
    };

function withRunnerSessionLock<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
  return withKeyedLock(runnerSessionLocks, deviceId, task);
}

export async function ensureRunnerSession(
  device: DeviceInfo,
  options: RunnerSessionOptions,
): Promise<RunnerSession> {
  return await withRunnerSessionLock(device.id, async () => {
    const existing = runnerSessions.get(device.id);
    if (existing) {
      if (isRunnerProcessAlive(existing.child.pid)) {
        emitDiagnostic({
          level: 'debug',
          phase: 'ios_runner_session_reuse',
          data: {
            deviceId: device.id,
            sessionId: existing.sessionId,
            ready: existing.ready,
          },
        });
        return existing;
      }
      await measureRunnerStartupStep({}, 'stop_stale_session', async () => {
        await stopRunnerSessionInternal(device.id, existing);
      });
    }

    const startupTimings: Record<string, number> = {};
    await measureRunnerStartupStep(startupTimings, 'ensure_booted', async () => {
      await ensureBootedIfNeeded(device);
    });
    if (options.cleanStaleBundles) {
      await measureRunnerStartupStep(startupTimings, 'cleanup_stale_bundles', async () => {
        await cleanupStaleSimulatorRunnerBundles(device);
      });
    } else {
      startupTimings.cleanup_stale_bundles = 0;
      emitDiagnostic({
        level: 'debug',
        phase: 'ios_runner_startup_cleanup_stale_bundles_skipped',
      });
    }
    const xctestrun = await measureRunnerStartupStep(
      startupTimings,
      'ensure_xctestrun',
      async () => await ensureXctestrun(device, options),
    );
    const port = await measureRunnerStartupStep(
      startupTimings,
      'allocate_port',
      async () => await getFreePort(),
    );
    const { xctestrunPath, jsonPath } = await measureRunnerStartupStep(
      startupTimings,
      'prepare_xctestrun_env',
      async () =>
        await prepareXctestrunWithEnv(
          xctestrun,
          { AGENT_DEVICE_RUNNER_PORT: String(port) },
          `session-${device.id}-${port}`,
        ),
    );
    const simulatorSetRedirect = await measureRunnerStartupStep(
      startupTimings,
      'simulator_set_redirect',
      async () => await acquireXcodebuildSimulatorSetRedirect(device),
    );
    let child: ExecBackgroundResult['child'];
    let testPromise: Promise<ExecResult>;
    try {
      ({ child, wait: testPromise } = await measureRunnerStartupStep(
        startupTimings,
        'launch_xcodebuild',
        () =>
          runCmdBackground(
            'xcodebuild',
            [
              'test-without-building',
              '-only-testing',
              'AgentDeviceRunnerUITests/RunnerTests/testCommand',
              '-parallel-testing-enabled',
              'NO',
              '-test-timeouts-enabled',
              'NO',
              '-collect-test-diagnostics',
              'never',
              resolveRunnerMaxConcurrentDestinationsFlag(device),
              '1',
              '-destination-timeout',
              String(RUNNER_DESTINATION_TIMEOUT_SECONDS),
              '-xctestrun',
              xctestrunPath,
              '-destination',
              resolveRunnerDestination(device),
            ],
            {
              allowFailure: true,
              env: { ...process.env, AGENT_DEVICE_RUNNER_PORT: String(port) },
              detached: true,
            },
          ),
      ));
    } catch (error) {
      await simulatorSetRedirect?.release();
      throw error;
    }
    child.stdout?.on('data', (chunk: string) => {
      logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
    });
    child.stderr?.on('data', (chunk: string) => {
      logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
    });

    const session: RunnerSession = {
      sessionId: `${device.id}:${port}:${Date.now()}`,
      device,
      deviceId: device.id,
      port,
      xctestrunPath,
      jsonPath,
      testPromise,
      child,
      ready: false,
      startupTimings,
      simulatorSetRedirect: simulatorSetRedirect ?? undefined,
    };
    runnerSessions.set(device.id, session);
    return session;
  });
}

async function cleanupStaleSimulatorRunnerBundles(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') {
    return;
  }

  for (const bundleId of IOS_RUNNER_CONTAINER_BUNDLE_IDS) {
    const result = await runXcrun(
      buildSimctlArgsForDevice(device, ['uninstall', device.id, bundleId]),
      {
        allowFailure: true,
      },
    );
    if (result.exitCode !== 0) {
      const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
      if (
        !output.includes('not installed') &&
        !output.includes('found nothing') &&
        !output.includes('no such file') &&
        !output.includes('invalid device') &&
        !output.includes('could not find')
      ) {
        // Best-effort cleanup only; xcodebuild may still be able to install.
        continue;
      }
    }
  }
}

export function getRunnerSessionSnapshot(
  deviceId: string,
): { sessionId: string; alive: boolean } | null {
  const session = runnerSessions.get(deviceId);
  if (!session) return null;
  return {
    sessionId: session.sessionId,
    alive: isRunnerProcessAlive(session.child.pid),
  };
}

export async function stopRunnerSession(session: RunnerSession): Promise<void> {
  await withRunnerSessionLock(session.deviceId, async () => {
    await stopRunnerSessionInternal(session.deviceId, session);
  });
}

export async function invalidateRunnerSession(
  session: RunnerSession,
  reason: string,
): Promise<void> {
  await withRunnerSessionLock(session.deviceId, async () => {
    if (runnerSessions.get(session.deviceId) !== session) return;
    emitDiagnostic({
      level: 'warn',
      phase: 'ios_runner_session_invalidated',
      data: {
        deviceId: session.deviceId,
        sessionId: session.sessionId,
        reason,
      },
    });
    await stopRunnerSessionInternal(session.deviceId, session, {
      graceful: false,
      waitTimeoutMs: RUNNER_INVALIDATE_WAIT_TIMEOUT_MS,
    });
  });
}

async function stopRunnerSessionInternal(
  deviceId: string,
  sessionOverride?: RunnerSession,
  options: { graceful?: boolean; waitTimeoutMs?: number } = {},
): Promise<void> {
  const session = sessionOverride ?? runnerSessions.get(deviceId);
  if (!session) return;
  if (options.graceful !== false) {
    try {
      await waitForRunner(
        session.device,
        session.port,
        withRunnerCommandId({
          command: 'shutdown',
        } as RunnerCommand),
        undefined,
        RUNNER_SHUTDOWN_TIMEOUT_MS,
      );
    } catch {
      await killRunnerProcessTree(session.child.pid, 'SIGTERM');
    }
  } else {
    await killRunnerProcessTree(session.child.pid, 'SIGTERM');
  }
  try {
    await Promise.race([
      session.testPromise,
      new Promise<void>((resolve) =>
        setTimeout(resolve, options.waitTimeoutMs ?? RUNNER_STOP_WAIT_TIMEOUT_MS),
      ),
    ]);
  } catch {}
  if (isRunnerProcessTreeAlive(session.child.pid)) {
    await killRunnerProcessTree(session.child.pid, 'SIGKILL');
  }
  cleanupTempFile(session.xctestrunPath);
  cleanupTempFile(session.jsonPath);
  await session.simulatorSetRedirect?.release();
  if (runnerSessions.get(deviceId) === session) {
    runnerSessions.delete(deviceId);
  }
}

export async function stopIosRunnerSession(deviceId: string): Promise<void> {
  await withRunnerSessionLock(deviceId, async () => {
    await stopRunnerSessionInternal(deviceId);
  });
}

export async function abortAllIosRunnerSessions(): Promise<void> {
  const activeSessions = Array.from(runnerSessions.values());
  const prepProcesses = Array.from(runnerPrepProcesses);
  await Promise.allSettled(
    activeSessions.map(async (session) => {
      await killRunnerProcessTree(session.child.pid, 'SIGINT');
    }),
  );
  await Promise.allSettled(
    prepProcesses.map(async (child) => {
      await killRunnerProcessTree(child.pid, 'SIGINT');
    }),
  );
  await Promise.allSettled(
    activeSessions.map(async (session) => {
      await killRunnerProcessTree(session.child.pid, 'SIGTERM');
    }),
  );
  await Promise.allSettled(
    prepProcesses.map(async (child) => {
      await killRunnerProcessTree(child.pid, 'SIGTERM');
    }),
  );
  await Promise.allSettled(
    activeSessions.map(async (session) => {
      await killRunnerProcessTree(session.child.pid, 'SIGKILL');
    }),
  );
  await Promise.allSettled(
    prepProcesses.map(async (child) => {
      await killRunnerProcessTree(child.pid, 'SIGKILL');
      runnerPrepProcesses.delete(child);
    }),
  );
  await Promise.allSettled(
    activeSessions.map(async (session) => {
      await session.simulatorSetRedirect?.release();
    }),
  );
}

export async function stopAllIosRunnerSessions(): Promise<void> {
  await abortAllIosRunnerSessions();
  const pending = Array.from(runnerSessions.keys());
  await Promise.allSettled(
    pending.map(async (deviceId) => {
      await stopIosRunnerSession(deviceId);
    }),
  );
  const prepProcesses = Array.from(runnerPrepProcesses);
  await Promise.allSettled(
    prepProcesses.map(async (child) => {
      try {
        await killRunnerProcessTree(child.pid, 'SIGTERM');
        await killRunnerProcessTree(child.pid, 'SIGKILL');
      } finally {
        runnerPrepProcesses.delete(child);
      }
    }),
  );
}

function isRunnerProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  return isProcessAlive(pid);
}

function isRunnerProcessTreeAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  return isRunnerProcessAlive(pid) || isProcessGroupAlive(pid);
}

async function killRunnerProcessTree(
  pid: number | undefined,
  signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL',
): Promise<void> {
  if (!pid || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {}
  try {
    process.kill(pid, signal);
  } catch {}
  const pkillSignal = signal === 'SIGINT' ? 'INT' : signal === 'SIGTERM' ? 'TERM' : 'KILL';
  try {
    await runAppleToolCommand('pkill', [`-${pkillSignal}`, '-P', String(pid)], {
      allowFailure: true,
    });
  } catch {}
}

function ensureBootedIfNeeded(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') {
    return Promise.resolve();
  }
  if (device.booted) {
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_runner_startup_ensure_booted_skipped',
      data: { deviceId: device.id },
    });
    return Promise.resolve();
  }
  return ensureBooted(device);
}

async function ensureBooted(device: DeviceInfo): Promise<void> {
  await runXcrun(buildSimctlArgsForDevice(device, ['bootstatus', device.id, '-b']), {
    timeoutMs: RUNNER_STARTUP_TIMEOUT_MS,
  });
}

export function validateRunnerDevice(device: DeviceInfo): void {
  if (device.platform !== 'ios' && device.platform !== 'macos') {
    throw new AppError(
      'UNSUPPORTED_PLATFORM',
      `Unsupported platform for iOS runner: ${device.platform}`,
    );
  }
  if (device.kind !== 'simulator' && device.kind !== 'device') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Unsupported iOS device kind for runner: ${device.kind}`,
    );
  }
}

export async function executeRunnerCommandWithSession(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  logPath: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  emitRunnerStartupTimings(session, command.command);
  const runnerCommand = withRunnerCommandId(command);
  const readOnlyCommand = isReadOnlyRunnerCommand(runnerCommand.command);
  if (readOnlyCommand) {
    const response = await withDiagnosticTimer(
      'ios_runner_command_send',
      async () =>
        await waitForRunner(
          device,
          session.port,
          runnerCommand,
          logPath,
          timeoutMs,
          session,
          signal,
        ),
      {
        command: runnerCommand.command,
        commandId: runnerCommand.commandId,
        readOnly: true,
        sessionReady: session.ready,
        timeoutMs,
      },
    );
    return await parseRunnerResponse(response, session, logPath);
  }

  const deadline = Deadline.fromTimeoutMs(timeoutMs);
  const preflightDecision = resolveRunnerReadinessPreflightDecision(session, runnerCommand);
  if (preflightDecision.action === 'run') {
    const readinessTimeoutMs = session.ready
      ? Math.min(RUNNER_READY_PREFLIGHT_TIMEOUT_MS, deadline.remainingMs())
      : Math.min(RUNNER_STARTUP_TIMEOUT_MS, deadline.remainingMs());
    try {
      const readinessResponse = await withDiagnosticTimer(
        'ios_runner_readiness_preflight',
        async () =>
          await waitForRunner(
            device,
            session.port,
            withRunnerCommandId({ command: 'uptime' }),
            logPath,
            readinessTimeoutMs,
            session,
            signal,
          ),
        {
          command: runnerCommand.command,
          commandId: runnerCommand.commandId,
          lastSuccessfulRunnerResponseAgeMs: preflightDecision.lastSuccessfulRunnerResponseAgeMs,
          reason: preflightDecision.reason,
          sessionReady: session.ready,
          timeoutMs: readinessTimeoutMs,
        },
      );
      await parseRunnerResponse(readinessResponse, session, logPath);
    } catch (error) {
      throw markRunnerReadinessPreflightError(error);
    }
  } else {
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_runner_readiness_preflight_skipped',
      data: {
        command: command.command,
        commandId: runnerCommand.commandId,
        lastSuccessfulRunnerResponseAgeMs: preflightDecision.lastSuccessfulRunnerResponseAgeMs,
        reason: preflightDecision.reason,
        sessionReady: session.ready,
      },
    });
  }
  const remainingMs = deadline.remainingMs();
  if (remainingMs <= 0) {
    throw new AppError('COMMAND_FAILED', 'Runner command deadline exceeded', { timeoutMs });
  }
  const response = await withDiagnosticTimer(
    'ios_runner_command_send',
    async () =>
      await sendRunnerCommandOnce(device, session.port, runnerCommand, remainingMs, signal),
    { command: runnerCommand.command, commandId: runnerCommand.commandId },
  ).catch((error: unknown) => {
    if (preflightDecision.action === 'skip') {
      throw markRunnerSkippedReadinessPreflightError(error, preflightDecision);
    }
    throw error;
  });
  return await parseRunnerResponse(response, session, logPath);
}

type RunnerResponsePayload = {
  ok?: unknown;
  error?: { code?: unknown; message?: unknown; hint?: unknown };
  data?: unknown;
};

export async function parseRunnerResponse(
  response: Response,
  session: Pick<RunnerSession, 'ready' | 'lastSuccessfulRunnerResponseAtMs'>,
  logPath?: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let json: RunnerResponsePayload;
  try {
    const parsed: unknown = JSON.parse(text);
    json = parsed && typeof parsed === 'object' ? (parsed as RunnerResponsePayload) : {};
  } catch {
    throw new AppError('COMMAND_FAILED', 'Invalid runner response', { text });
  }
  if (!json.ok) {
    const rawCode = json.error?.code;
    const errorCode =
      typeof rawCode === 'string' && rawCode.trim().length > 0
        ? toAppErrorCode(rawCode)
        : 'COMMAND_FAILED';
    const errorMessage = typeof json.error?.message === 'string' ? json.error.message : undefined;
    const hint = typeof json.error?.hint === 'string' ? json.error.hint : undefined;
    throw new AppError(errorCode, errorMessage ?? 'Runner error', {
      runner: json,
      xcodebuild: {
        exitCode: 1,
        stdout: '',
        stderr: '',
      },
      hint,
      logPath,
    });
  }
  session.ready = true;
  session.lastSuccessfulRunnerResponseAtMs = Date.now();
  if (json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
    const data = json.data as Record<string, unknown>;
    emitRunnerResponseDiagnostics(data);
    return data;
  }
  return {};
}

function emitRunnerResponseDiagnostics(data: Record<string, unknown>): void {
  const fallback = data.gestureFallback;
  if (typeof fallback !== 'string' || fallback.length === 0) return;
  emitDiagnostic({
    level: 'debug',
    phase: 'ios_runner_gesture_fallback',
    data: {
      fallback,
      message:
        typeof data.gestureFallbackMessage === 'string' ? data.gestureFallbackMessage : undefined,
      hint: typeof data.gestureFallbackHint === 'string' ? data.gestureFallbackHint : undefined,
    },
  });
}

function resolveRunnerReadinessPreflightDecision(
  session: RunnerSession,
  command: RunnerCommand,
): RunnerReadinessPreflightDecision {
  if (!session.ready) {
    return {
      action: 'run',
      reason: 'startup',
    };
  }
  if (command.command !== 'tap' && command.command !== 'tapSeries') {
    return {
      action: 'run',
      reason: 'conservative_command',
    };
  }
  const lastSuccessAt = session.lastSuccessfulRunnerResponseAtMs;
  if (lastSuccessAt === undefined) {
    return {
      action: 'run',
      reason: 'no_successful_response',
    };
  }
  const lastSuccessfulRunnerResponseAgeMs = Date.now() - lastSuccessAt;
  if (lastSuccessfulRunnerResponseAgeMs > RUNNER_TAP_PREFLIGHT_SKIP_FRESHNESS_MS) {
    return {
      action: 'run',
      reason: 'successful_response_stale',
      lastSuccessfulRunnerResponseAgeMs,
    };
  }
  return {
    action: 'skip',
    reason: 'recent_successful_response',
    lastSuccessfulRunnerResponseAgeMs,
  };
}

function markRunnerReadinessPreflightError(error: unknown): AppError {
  return markRunnerPreflightError(error, {
    runnerReadinessPreflightFailed: true,
  });
}

function markRunnerSkippedReadinessPreflightError(
  error: unknown,
  decision: Extract<RunnerReadinessPreflightDecision, { action: 'skip' }>,
): AppError {
  return markRunnerPreflightError(error, {
    runnerReadinessPreflightSkipped: true,
    runnerReadinessPreflightSkipReason: decision.reason,
    runnerReadinessPreflightSkippedAgeMs: decision.lastSuccessfulRunnerResponseAgeMs,
  });
}

function markRunnerPreflightError(error: unknown, details: Record<string, unknown>): AppError {
  const appErr =
    error instanceof AppError
      ? error
      : new AppError(
          'COMMAND_FAILED',
          error instanceof Error ? error.message : String(error),
          undefined,
          error,
        );
  return new AppError(
    appErr.code,
    appErr.message,
    {
      ...(appErr.details ?? {}),
      ...details,
    },
    appErr.cause ?? error,
  );
}

async function measureRunnerStartupStep<T>(
  timings: Record<string, number>,
  phase: string,
  task: () => Promise<T> | T,
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await task();
  } finally {
    const durationMs = Date.now() - startedAt;
    timings[phase] = durationMs;
    emitDiagnostic({
      level: 'debug',
      phase: `ios_runner_startup_${phase}`,
      durationMs,
    });
  }
}

function emitRunnerStartupTimings(session: RunnerSession, command: string): void {
  if (session.startupTimingsReported || !session.startupTimings) return;
  session.startupTimingsReported = true;
  const totalMs = Object.values(session.startupTimings).reduce((sum, value) => sum + value, 0);
  emitDiagnostic({
    level: 'info',
    phase: 'ios_runner_session_startup_timings',
    durationMs: totalMs,
    data: {
      command,
      sessionId: session.sessionId,
      ready: session.ready,
      timings: session.startupTimings,
    },
  });
}
