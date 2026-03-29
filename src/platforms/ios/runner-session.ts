import { AppError } from '../../utils/errors.ts';
import {
  runCmd,
  runCmdBackground,
  type ExecResult,
  type ExecBackgroundResult,
} from '../../utils/exec.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { isProcessAlive } from '../../utils/process-identity.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';
import {
  waitForRunner,
  getFreePort,
  logChunk,
  cleanupTempFile,
  RUNNER_STARTUP_TIMEOUT_MS,
  RUNNER_DESTINATION_TIMEOUT_SECONDS,
} from './runner-transport.ts';
import {
  ensureXctestrun,
  IOS_RUNNER_CONTAINER_BUNDLE_IDS,
  prepareXctestrunWithEnv,
  resolveRunnerDestination,
  resolveRunnerMaxConcurrentDestinationsFlag,
  runnerPrepProcesses,
} from './runner-xctestrun.ts';
import type { RunnerCommand } from './runner-contract.ts';

export type RunnerSession = {
  sessionId: string;
  device: DeviceInfo;
  deviceId: string;
  port: number;
  xctestrunPath: string;
  jsonPath: string;
  testPromise: Promise<ExecResult>;
  child: ExecBackgroundResult['child'];
  ready: boolean;
};

const runnerSessions = new Map<string, RunnerSession>();
const runnerSessionLocks = new Map<string, Promise<unknown>>();
const RUNNER_STOP_WAIT_TIMEOUT_MS = 10_000;
const RUNNER_SHUTDOWN_TIMEOUT_MS = 15_000;

function withRunnerSessionLock<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
  return withKeyedLock(runnerSessionLocks, deviceId, task);
}

export async function ensureRunnerSession(
  device: DeviceInfo,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<RunnerSession> {
  return await withRunnerSessionLock(device.id, async () => {
    const existing = runnerSessions.get(device.id);
    if (existing) {
      if (isRunnerProcessAlive(existing.child.pid)) {
        return existing;
      }
      await stopRunnerSessionInternal(device.id, existing);
    }

    await ensureBootedIfNeeded(device);
    await cleanupStaleSimulatorRunnerBundles(device);
    const xctestrun = await ensureXctestrun(device, options);
    const port = await getFreePort();
    const { xctestrunPath, jsonPath } = await prepareXctestrunWithEnv(
      xctestrun,
      { AGENT_DEVICE_RUNNER_PORT: String(port) },
      `session-${device.id}-${port}`,
    );
    const { child, wait: testPromise } = runCmdBackground(
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
    );
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
    const result = await runCmd(
      'xcrun',
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

async function stopRunnerSessionInternal(
  deviceId: string,
  sessionOverride?: RunnerSession,
): Promise<void> {
  const session = sessionOverride ?? runnerSessions.get(deviceId);
  if (!session) return;
  try {
    await waitForRunner(
      session.device,
      session.port,
      {
        command: 'shutdown',
      } as RunnerCommand,
      undefined,
      RUNNER_SHUTDOWN_TIMEOUT_MS,
    );
  } catch {
    await killRunnerProcessTree(session.child.pid, 'SIGTERM');
  }
  try {
    await Promise.race([
      session.testPromise,
      new Promise<void>((resolve) => setTimeout(resolve, RUNNER_STOP_WAIT_TIMEOUT_MS)),
    ]);
  } catch {
    // ignore
  }
  await killRunnerProcessTree(session.child.pid, 'SIGKILL');
  cleanupTempFile(session.xctestrunPath);
  cleanupTempFile(session.jsonPath);
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

async function killRunnerProcessTree(
  pid: number | undefined,
  signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL',
): Promise<void> {
  if (!pid || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    // ignore
  }
  try {
    process.kill(pid, signal);
  } catch {
    // ignore
  }
  const pkillSignal = signal === 'SIGINT' ? 'INT' : signal === 'SIGTERM' ? 'TERM' : 'KILL';
  try {
    await runCmd('pkill', [`-${pkillSignal}`, '-P', String(pid)], { allowFailure: true });
  } catch {
    // ignore
  }
}

function ensureBootedIfNeeded(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') {
    return Promise.resolve();
  }
  return ensureBooted(device);
}

async function ensureBooted(device: DeviceInfo): Promise<void> {
  await runCmd('xcrun', buildSimctlArgsForDevice(device, ['bootstatus', device.id, '-b']), {
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
  const response = await waitForRunner(
    device,
    session.port,
    command,
    logPath,
    timeoutMs,
    session,
    signal,
  );
  return await parseRunnerResponse(response, session, logPath);
}

export async function parseRunnerResponse(
  response: Response,
  session: RunnerSession,
  logPath?: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let json: any = {};
  try {
    json = JSON.parse(text);
  } catch {
    throw new AppError('COMMAND_FAILED', 'Invalid runner response', { text });
  }
  if (!json.ok) {
    const errorCode =
      typeof json.error?.code === 'string' && json.error.code.trim().length > 0
        ? json.error.code
        : 'COMMAND_FAILED';
    throw new AppError(errorCode, json.error?.message ?? 'Runner error', {
      runner: json,
      xcodebuild: {
        exitCode: 1,
        stdout: '',
        stderr: '',
      },
      logPath,
    });
  }
  session.ready = true;
  return json.data ?? {};
}
