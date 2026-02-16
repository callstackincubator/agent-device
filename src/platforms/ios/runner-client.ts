import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/errors.ts';
import { runCmd, runCmdStreaming, runCmdBackground, type ExecResult, type ExecBackgroundResult } from '../../utils/exec.ts';
import { Deadline, isEnvTruthy, retryWithPolicy, withRetry } from '../../utils/retry.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { isProcessAlive } from '../../utils/process-identity.ts';
import net from 'node:net';
import { bootFailureHint, classifyBootFailure } from '../boot-diagnostics.ts';
import { resolveTimeoutMs, resolveTimeoutValue } from '../../utils/timeouts.ts';

export type RunnerCommand = {
  command:
    | 'tap'
    | 'longPress'
    | 'drag'
    | 'type'
    | 'swipe'
    | 'findText'
    | 'listTappables'
    | 'snapshot'
    | 'back'
    | 'home'
    | 'appSwitcher'
    | 'alert'
    | 'pinch'
    | 'shutdown';
  appBundleId?: string;
  text?: string;
  action?: 'get' | 'accept' | 'dismiss';
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  durationMs?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  scale?: number;
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
  clearFirst?: boolean;
};

export type RunnerSession = {
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
const RUNNER_STARTUP_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_STARTUP_TIMEOUT_MS,
  45_000,
  5_000,
);
const RUNNER_COMMAND_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_COMMAND_TIMEOUT_MS,
  15_000,
  1_000,
);
const RUNNER_CONNECT_ATTEMPT_INTERVAL_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_ATTEMPT_INTERVAL_MS,
  250,
  50,
);
const RUNNER_CONNECT_RETRY_BASE_DELAY_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_RETRY_BASE_DELAY_MS,
  300,
  10,
);
const RUNNER_CONNECT_RETRY_MAX_DELAY_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_RETRY_MAX_DELAY_MS,
  2_000,
  10,
);
const RUNNER_CONNECT_REQUEST_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_REQUEST_TIMEOUT_MS,
  5_000,
  250,
);
const RUNNER_DEVICE_INFO_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_DEVICE_INFO_TIMEOUT_MS,
  10_000,
  500,
);
const RUNNER_DESTINATION_TIMEOUT_SECONDS = resolveTimeoutValue(
  process.env.AGENT_DEVICE_RUNNER_DESTINATION_TIMEOUT_SECONDS,
  20,
  5,
);
const RUNNER_STOP_WAIT_TIMEOUT_MS = 10_000;
const RUNNER_SHUTDOWN_TIMEOUT_MS = 15_000;
const RUNNER_DERIVED_ROOT = path.join(os.homedir(), '.agent-device', 'ios-runner');

export type RunnerSnapshotNode = {
  index: number;
  type?: string;
  label?: string;
  value?: string;
  identifier?: string;
  rect?: { x: number; y: number; width: number; height: number };
  enabled?: boolean;
  hittable?: boolean;
  depth?: number;
};

export async function runIosRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string } = {},
): Promise<Record<string, unknown>> {
  validateRunnerDevice(device);
  if (isReadOnlyRunnerCommand(command.command)) {
    return withRetry(
      () => executeRunnerCommand(device, command, options),
      { shouldRetry: isRetryableRunnerError },
    );
  }
  return executeRunnerCommand(device, command, options);
}

function withRunnerSessionLock<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
  return withKeyedLock(runnerSessionLocks, deviceId, task);
}

async function executeRunnerCommand(
  device: DeviceInfo,
  command: RunnerCommand,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string } = {},
): Promise<Record<string, unknown>> {
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
      );
      return await parseRunnerResponse(response, session, options.logPath);
    }
    throw err;
  }
}

async function executeRunnerCommandWithSession(
  device: DeviceInfo,
  session: RunnerSession,
  command: RunnerCommand,
  logPath: string | undefined,
  timeoutMs: number,
): Promise<Record<string, unknown>> {
  const response = await waitForRunner(device, session.port, command, logPath, timeoutMs, session);
  return await parseRunnerResponse(response, session, logPath);
}

async function parseRunnerResponse(
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
    throw new AppError('COMMAND_FAILED', json.error?.message ?? 'Runner error', {
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

export async function stopIosRunnerSession(deviceId: string): Promise<void> {
  await withRunnerSessionLock(deviceId, async () => {
    await stopRunnerSessionInternal(deviceId);
  });
}

export async function stopAllIosRunnerSessions(): Promise<void> {
  // Shutdown cleanup drains the sessions known at invocation time; daemon shutdown closes intake.
  const pending = Array.from(runnerSessions.keys());
  await Promise.allSettled(pending.map(async (deviceId) => {
    await stopIosRunnerSession(deviceId);
  }));
}

async function stopRunnerSession(session: RunnerSession): Promise<void> {
  await withRunnerSessionLock(session.deviceId, async () => {
    await stopRunnerSessionInternal(session.deviceId, session);
  });
}

async function stopRunnerSessionInternal(deviceId: string, sessionOverride?: RunnerSession): Promise<void> {
  const session = sessionOverride ?? runnerSessions.get(deviceId);
  if (!session) return;
  try {
    await waitForRunner(session.device, session.port, {
      command: 'shutdown',
    } as RunnerCommand, undefined, RUNNER_SHUTDOWN_TIMEOUT_MS);
  } catch {
    // Runner not responsive — send SIGTERM so we don't hang on testPromise
    await killRunnerProcessTree(session.child.pid, 'SIGTERM');
  }
  try {
    // Bound the wait so we never hang if xcodebuild refuses to exit
    await Promise.race([
      session.testPromise,
      new Promise<void>((resolve) => setTimeout(resolve, RUNNER_STOP_WAIT_TIMEOUT_MS)),
    ]);
  } catch {
    // ignore
  }
  // Force-kill if still alive (harmless if already exited)
  await killRunnerProcessTree(session.child.pid, 'SIGKILL');
  cleanupTempFile(session.xctestrunPath);
  cleanupTempFile(session.jsonPath);
  if (runnerSessions.get(deviceId) === session) {
    runnerSessions.delete(deviceId);
  }
}

async function ensureBooted(udid: string): Promise<void> {
  await runCmd('xcrun', ['simctl', 'bootstatus', udid, '-b'], {
    allowFailure: true,
    timeoutMs: RUNNER_STARTUP_TIMEOUT_MS,
  });
}

async function ensureRunnerSession(
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
      },
    );
    child.stdout?.on('data', (chunk: string) => {
      logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
    });
    child.stderr?.on('data', (chunk: string) => {
      logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
    });

    const session: RunnerSession = {
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

function isRunnerProcessAlive(pid: number | undefined): boolean {
  if (!pid) return false;
  return isProcessAlive(pid);
}

async function killRunnerProcessTree(
  pid: number | undefined,
  signal: 'SIGTERM' | 'SIGKILL',
): Promise<void> {
  if (!pid || pid <= 0) return;
  try {
    process.kill(pid, signal);
  } catch {
    // ignore
  }
  const pkillSignal = signal === 'SIGTERM' ? 'TERM' : 'KILL';
  try {
    await runCmd('pkill', [`-${pkillSignal}`, '-P', String(pid)], { allowFailure: true });
  } catch {
    // ignore
  }
}


async function ensureXctestrun(
  device: DeviceInfo,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<string> {
  const derived = resolveRunnerDerivedPath(device.kind);
  if (shouldCleanDerived()) {
    assertSafeDerivedCleanup(derived);
    try {
      fs.rmSync(derived, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  const existing = findXctestrun(derived);
  if (existing) return existing;

  const projectRoot = findProjectRoot();
  const projectPath = path.join(projectRoot, 'ios-runner', 'AgentDeviceRunner', 'AgentDeviceRunner.xcodeproj');

  if (!fs.existsSync(projectPath)) {
    throw new AppError('COMMAND_FAILED', 'iOS runner project not found', { projectPath });
  }

  const signingBuildSettings = resolveRunnerSigningBuildSettings(process.env, device.kind === 'device');
  const provisioningArgs = device.kind === 'device' ? ['-allowProvisioningUpdates'] : [];
  try {
    await runCmdStreaming(
      'xcodebuild',
      [
        'build-for-testing',
        '-project',
        projectPath,
        '-scheme',
        'AgentDeviceRunner',
        '-parallel-testing-enabled',
        'NO',
        resolveRunnerMaxConcurrentDestinationsFlag(device),
        '1',
        '-destination',
        resolveRunnerBuildDestination(device),
        '-derivedDataPath',
        derived,
        ...provisioningArgs,
        ...signingBuildSettings,
      ],
      {
        onStdoutChunk: (chunk) => {
          logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
        },
        onStderrChunk: (chunk) => {
          logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
        },
      },
    );
  } catch (err) {
    const appErr = err instanceof AppError ? err : new AppError('COMMAND_FAILED', String(err));
    const hint = resolveSigningFailureHint(appErr);
    throw new AppError('COMMAND_FAILED', 'xcodebuild build-for-testing failed', {
      error: appErr.message,
      details: appErr.details,
      logPath: options.logPath,
      hint,
    });
  }

  const built = findXctestrun(derived);
  if (!built) {
    throw new AppError('COMMAND_FAILED', 'Failed to locate .xctestrun after build');
  }
  return built;
}

function resolveRunnerDerivedPath(kind: DeviceInfo['kind']): string {
  const override = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (kind === 'simulator') {
    // Keep simulator runtime path aligned with pnpm build:xcuitest/build:all.
    return path.join(RUNNER_DERIVED_ROOT, 'derived');
  }
  return path.join(RUNNER_DERIVED_ROOT, 'derived', kind);
}

export function resolveRunnerDestination(device: DeviceInfo): string {
  if (device.platform !== 'ios') {
    throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform for iOS runner: ${device.platform}`);
  }
  if (device.kind === 'simulator') {
    return `platform=iOS Simulator,id=${device.id}`;
  }
  return `platform=iOS,id=${device.id}`;
}

export function resolveRunnerBuildDestination(device: DeviceInfo): string {
  if (device.platform !== 'ios') {
    throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform for iOS runner: ${device.platform}`);
  }
  if (device.kind === 'simulator') {
    return `platform=iOS Simulator,id=${device.id}`;
  }
  return 'generic/platform=iOS';
}

function ensureBootedIfNeeded(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') {
    return Promise.resolve();
  }
  return ensureBooted(device.id);
}

function validateRunnerDevice(device: DeviceInfo): void {
  if (device.platform !== 'ios') {
    throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform for iOS runner: ${device.platform}`);
  }
  if (device.kind !== 'simulator' && device.kind !== 'device') {
    throw new AppError('UNSUPPORTED_OPERATION', `Unsupported iOS device kind for runner: ${device.kind}`);
  }
}

export function resolveRunnerMaxConcurrentDestinationsFlag(device: DeviceInfo): string {
  return device.kind === 'device'
    ? '-maximum-concurrent-test-device-destinations'
    : '-maximum-concurrent-test-simulator-destinations';
}

export function resolveRunnerSigningBuildSettings(
  env: NodeJS.ProcessEnv = process.env,
  forDevice = false,
): string[] {
  if (!forDevice) {
    return [];
  }
  const teamId = env.AGENT_DEVICE_IOS_TEAM_ID?.trim() || '';
  const configuredIdentity = env.AGENT_DEVICE_IOS_SIGNING_IDENTITY?.trim() || '';
  const profile = env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE?.trim() || '';
  const args = ['CODE_SIGN_STYLE=Automatic'];
  if (teamId) {
    args.push(`DEVELOPMENT_TEAM=${teamId}`);
  }
  if (configuredIdentity) {
    args.push(`CODE_SIGN_IDENTITY=${configuredIdentity}`);
  }
  if (profile) args.push(`PROVISIONING_PROFILE_SPECIFIER=${profile}`);
  return args;
}

function resolveSigningFailureHint(error: AppError): string | undefined {
  const details = error.details ? JSON.stringify(error.details) : '';
  const combined = `${error.message}\n${details}`.toLowerCase();
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

function findXctestrun(root: string): string | null {
  if (!fs.existsSync(root)) return null;
  const candidates: { path: string; mtimeMs: number }[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.xctestrun')) {
        try {
          const stat = fs.statSync(full);
          candidates.push({ path: full, mtimeMs: stat.mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

function findProjectRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) return current;
    current = path.dirname(current);
  }
  return start;
}

function logChunk(chunk: string, logPath?: string, traceLogPath?: string, verbose?: boolean): void {
  if (logPath) fs.appendFileSync(logPath, chunk);
  if (traceLogPath) fs.appendFileSync(traceLogPath, chunk);
  if (verbose) {
    process.stderr.write(chunk);
  }
}

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

function isReadOnlyRunnerCommand(command: RunnerCommand['command']): boolean {
  return command === 'snapshot' || command === 'findText' || command === 'listTappables' || command === 'alert';
}

function shouldCleanDerived(): boolean {
  return isEnvTruthy(process.env.AGENT_DEVICE_IOS_CLEAN_DERIVED);
}

export function assertSafeDerivedCleanup(
  derivedPath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const override = env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH?.trim();
  if (!override) {
    return;
  }
  if (isCleanupOverrideAllowed(env)) {
    return;
  }
  throw new AppError(
    'COMMAND_FAILED',
    'Refusing to clean AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH automatically',
    {
      derivedPath,
      hint: 'Unset AGENT_DEVICE_IOS_CLEAN_DERIVED, or set AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN=1 if you trust this path.',
    },
  );
}

function isCleanupOverrideAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN);
}

function buildRunnerConnectError(params: {
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

export function resolveRunnerEarlyExitHint(message: string, stdout: string, stderr: string): string {
  const haystack = `${message}\n${stdout}\n${stderr}`.toLowerCase();
  if (haystack.includes('device is busy') && haystack.includes('connecting')) {
    return 'Target iOS device is still connecting. Keep it unlocked, wait for device trust/connection to settle, then retry.';
  }
  return bootFailureHint('IOS_RUNNER_CONNECT_TIMEOUT');
}

export function shouldRetryRunnerConnectError(error: unknown): boolean {
  if (!(error instanceof AppError)) return true;
  if (error.code !== 'COMMAND_FAILED') return true;
  const message = String(error.message ?? '').toLowerCase();
  if (message.includes('xcodebuild exited early')) return false;
  return true;
}

async function buildRunnerEarlyExitError(params: {
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

async function waitForRunner(
  device: DeviceInfo,
  port: number,
  command: RunnerCommand,
  logPath?: string,
  timeoutMs: number = RUNNER_STARTUP_TIMEOUT_MS,
  session?: RunnerSession,
): Promise<Response> {
  const deadline = Deadline.fromTimeoutMs(timeoutMs);
  let endpoints = await resolveRunnerCommandEndpoints(device, port, deadline.remainingMs());
  let lastError: unknown = null;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / RUNNER_CONNECT_ATTEMPT_INTERVAL_MS));
  try {
    return await retryWithPolicy(
      async ({ deadline: attemptDeadline }) => {
        if (attemptDeadline?.isExpired()) {
          throw new AppError('COMMAND_FAILED', 'Runner connection deadline exceeded', {
            port,
            timeoutMs,
          });
        }
        if (session && session.child.exitCode !== null && session.child.exitCode !== undefined) {
          throw await buildRunnerEarlyExitError({ session, port, logPath });
        }
        if (device.kind === 'device') {
          endpoints = await resolveRunnerCommandEndpoints(device, port, attemptDeadline?.remainingMs());
        }
        for (const endpoint of endpoints) {
          try {
            const remainingMs = attemptDeadline?.remainingMs() ?? timeoutMs;
            if (remainingMs <= 0) {
              throw new AppError('COMMAND_FAILED', 'Runner connection deadline exceeded', {
                port,
                timeoutMs,
              });
            }
            const response = await fetchWithTimeout(
              endpoint,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(command),
              },
              Math.min(RUNNER_CONNECT_REQUEST_TIMEOUT_MS, remainingMs),
            );
            return response;
          } catch (err) {
            lastError = err;
          }
        }
        throw new AppError('COMMAND_FAILED', 'Runner endpoint probe failed', {
          port,
          endpoints,
          lastError: lastError ? String(lastError) : undefined,
        });
      },
      {
        maxAttempts,
        baseDelayMs: RUNNER_CONNECT_RETRY_BASE_DELAY_MS,
        maxDelayMs: RUNNER_CONNECT_RETRY_MAX_DELAY_MS,
        jitter: 0.2,
        shouldRetry: shouldRetryRunnerConnectError,
      },
      { deadline, phase: 'ios_runner_connect' },
    );
  } catch (error) {
    if (!lastError) {
      lastError = error;
    }
  }

  if (device.kind === 'simulator') {
    const remainingMs = deadline.remainingMs();
    if (remainingMs <= 0) {
      throw buildRunnerConnectError({ port, endpoints, logPath, lastError });
    }
    const simResponse = await postCommandViaSimulator(device.id, port, command, remainingMs);
    return new Response(simResponse.body, { status: simResponse.status });
  }

  throw buildRunnerConnectError({ port, endpoints, logPath, lastError });
}

async function resolveRunnerCommandEndpoints(
  device: DeviceInfo,
  port: number,
  timeoutBudgetMs?: number,
): Promise<string[]> {
  const endpoints = [`http://127.0.0.1:${port}/command`];
  if (device.kind !== 'device') {
    return endpoints;
  }
  const tunnelIp = await resolveDeviceTunnelIp(device.id, timeoutBudgetMs);
  if (tunnelIp) {
    endpoints.unshift(`http://[${tunnelIp}]:${port}/command`);
  }
  return endpoints;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveDeviceTunnelIp(deviceId: string, timeoutBudgetMs?: number): Promise<string | null> {
  if (typeof timeoutBudgetMs === 'number' && timeoutBudgetMs <= 0) {
    return null;
  }
  const timeoutMs = typeof timeoutBudgetMs === 'number'
    ? Math.max(1, Math.min(RUNNER_DEVICE_INFO_TIMEOUT_MS, timeoutBudgetMs))
    : RUNNER_DEVICE_INFO_TIMEOUT_MS;
  const jsonPath = path.join(
    os.tmpdir(),
    `agent-device-devicectl-info-${process.pid}-${Date.now()}.json`,
  );
  try {
    const devicectlTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const result = await runCmd(
      'xcrun',
      [
        'devicectl',
        'device',
        'info',
        'details',
        '--device',
        deviceId,
        '--json-output',
        jsonPath,
        '--timeout',
        String(devicectlTimeoutSeconds),
      ],
      { allowFailure: true, timeoutMs },
    );
    if (result.exitCode !== 0 || !fs.existsSync(jsonPath)) {
      return null;
    }
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      info?: { outcome?: string };
      result?: {
        connectionProperties?: { tunnelIPAddress?: string };
        device?: { connectionProperties?: { tunnelIPAddress?: string } };
      };
    };
    if (payload.info?.outcome && payload.info.outcome !== 'success') {
      return null;
    }
    const ip = (
      payload.result?.connectionProperties?.tunnelIPAddress
      ?? payload.result?.device?.connectionProperties?.tunnelIPAddress
    )?.trim();
    return ip && ip.length > 0 ? ip : null;
  } catch {
    return null;
  } finally {
    cleanupTempFile(jsonPath);
  }
}

async function postCommandViaSimulator(
  udid: string,
  port: number,
  command: RunnerCommand,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(command);
  const result = await runCmd(
    'xcrun',
    [
      'simctl',
      'spawn',
      udid,
      '/usr/bin/curl',
      '-s',
      '-X',
      'POST',
      '-H',
      'Content-Type: application/json',
      '--data',
      payload,
      `http://127.0.0.1:${port}/command`,
    ],
    { allowFailure: true, timeoutMs },
  );
  const body = result.stdout as string;
  if (result.exitCode !== 0) {
    const reason = classifyBootFailure({
      message: 'Runner did not accept connection (simctl spawn)',
      stdout: result.stdout,
      stderr: result.stderr,
      context: { platform: 'ios', phase: 'connect' },
    });
    throw new AppError('COMMAND_FAILED', 'Runner did not accept connection (simctl spawn)', {
      port,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      reason,
      hint: bootFailureHint(reason),
    });
  }
  return { status: 200, body };
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
      } else {
        reject(new AppError('COMMAND_FAILED', 'Failed to allocate port'));
      }
    });
    server.on('error', reject);
  });
}

async function prepareXctestrunWithEnv(
  xctestrunPath: string,
  envVars: Record<string, string>,
  suffix: string,
): Promise<{ xctestrunPath: string; jsonPath: string }> {
  const dir = path.dirname(xctestrunPath);
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpJsonPath = path.join(dir, `AgentDeviceRunner.env.${safeSuffix}.json`);
  const tmpXctestrunPath = path.join(dir, `AgentDeviceRunner.env.${safeSuffix}.xctestrun`);

  const jsonResult = await runCmd('plutil', ['-convert', 'json', '-o', '-', xctestrunPath], {
    allowFailure: true,
  });
  if (jsonResult.exitCode !== 0 || !jsonResult.stdout.trim()) {
    throw new AppError('COMMAND_FAILED', 'Failed to read xctestrun plist', {
      xctestrunPath,
      stderr: jsonResult.stderr,
    });
  }

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(jsonResult.stdout) as Record<string, any>;
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'Failed to parse xctestrun JSON', {
      xctestrunPath,
      error: String(err),
    });
  }

  const applyEnvToTarget = (target: Record<string, any>) => {
    target.EnvironmentVariables = { ...(target.EnvironmentVariables ?? {}), ...envVars };
    target.UITestEnvironmentVariables = { ...(target.UITestEnvironmentVariables ?? {}), ...envVars };
    target.UITargetAppEnvironmentVariables = {
      ...(target.UITargetAppEnvironmentVariables ?? {}),
      ...envVars,
    };
    target.TestingEnvironmentVariables = { ...(target.TestingEnvironmentVariables ?? {}), ...envVars };
  };

  const configs = parsed.TestConfigurations;
  if (Array.isArray(configs)) {
    for (const config of configs) {
      if (!config || typeof config !== 'object') continue;
      const targets = config.TestTargets;
      if (!Array.isArray(targets)) continue;
      for (const target of targets) {
        if (!target || typeof target !== 'object') continue;
        applyEnvToTarget(target);
      }
    }
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (value && typeof value === 'object' && value.TestBundlePath) {
      applyEnvToTarget(value);
      parsed[key] = value;
    }
  }

  fs.writeFileSync(tmpJsonPath, JSON.stringify(parsed, null, 2));
  const plistResult = await runCmd('plutil', ['-convert', 'xml1', '-o', tmpXctestrunPath, tmpJsonPath], {
    allowFailure: true,
  });
  if (plistResult.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to write xctestrun plist', {
      tmpXctestrunPath,
      stderr: plistResult.stderr,
    });
  }

  return { xctestrunPath: tmpXctestrunPath, jsonPath: tmpJsonPath };
}

function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}
