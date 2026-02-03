import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/errors.ts';
import { runCmd, runCmdStreaming, type ExecResult } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import net from 'node:net';

export type RunnerCommand = {
  command:
    | 'tap'
    | 'type'
    | 'swipe'
    | 'findText'
    | 'listTappables'
    | 'snapshot'
    | 'back'
    | 'home'
    | 'appSwitcher'
    | 'alert'
    | 'shutdown';
  appBundleId?: string;
  text?: string;
  action?: 'get' | 'accept' | 'dismiss';
  x?: number;
  y?: number;
  direction?: 'up' | 'down' | 'left' | 'right';
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
};

export type RunnerSession = {
  device: DeviceInfo;
  deviceId: string;
  port: number;
  xctestrunPath: string;
  jsonPath: string;
  testPromise: Promise<ExecResult>;
};

const runnerSessions = new Map<string, RunnerSession>();

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
  if (device.kind !== 'simulator') {
    throw new AppError('UNSUPPORTED_OPERATION', 'iOS runner only supports simulators in v1');
  }

  try {
    const session = await ensureRunnerSession(device, options);
    const response = await waitForRunner(device, session.port, command, options.logPath);
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
        logPath: options.logPath,
      });
    }

    return json.data ?? {};
  } catch (err) {
    const appErr = err instanceof AppError ? err : new AppError('COMMAND_FAILED', String(err));
    if (
      appErr.code === 'COMMAND_FAILED' &&
      typeof appErr.message === 'string' &&
      appErr.message.includes('Runner did not accept connection')
    ) {
      await stopIosRunnerSession(device.id);
      const session = await ensureRunnerSession(device, options);
      const response = await waitForRunner(device, session.port, command, options.logPath);
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
          logPath: options.logPath,
        });
      }
      return json.data ?? {};
    }
    throw err;
  }
}

export async function stopIosRunnerSession(deviceId: string): Promise<void> {
  const session = runnerSessions.get(deviceId);
  if (!session) return;
  try {
    await waitForRunner(session.device, session.port, {
      command: 'shutdown',
    } as RunnerCommand);
  } catch {
    // ignore
  }
  try {
    await session.testPromise;
  } catch {
    // ignore
  }
  cleanupTempFile(session.xctestrunPath);
  cleanupTempFile(session.jsonPath);
  runnerSessions.delete(deviceId);
}

async function ensureBooted(udid: string): Promise<void> {
  await runCmd('xcrun', ['simctl', 'bootstatus', udid, '-b'], { allowFailure: true });
}

async function ensureRunnerSession(
  device: DeviceInfo,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<RunnerSession> {
  const existing = runnerSessions.get(device.id);
  if (existing) return existing;

  await ensureBooted(device.id);
  const xctestrun = await ensureXctestrun(device.id, options);
  const port = await getFreePort();
  const runnerTimeout = process.env.AGENT_DEVICE_RUNNER_TIMEOUT ?? '300';
  const { xctestrunPath, jsonPath } = await prepareXctestrunWithEnv(
    xctestrun,
    { AGENT_DEVICE_RUNNER_PORT: String(port), AGENT_DEVICE_RUNNER_TIMEOUT: runnerTimeout },
    `session-${device.id}-${port}`,
  );
  const testPromise = runCmdStreaming(
    'xcodebuild',
    [
      'test-without-building',
      '-only-testing',
      'AgentDeviceRunnerUITests/RunnerTests/testCommand',
      '-parallel-testing-enabled',
      'NO',
      '-maximum-concurrent-test-simulator-destinations',
      '1',
      '-xctestrun',
      xctestrunPath,
      '-destination',
      `platform=iOS Simulator,id=${device.id}`,
    ],
    {
      onStdoutChunk: (chunk) => {
        logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
      },
      onStderrChunk: (chunk) => {
        logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
      },
      allowFailure: true,
      env: { ...process.env, AGENT_DEVICE_RUNNER_PORT: String(port), AGENT_DEVICE_RUNNER_TIMEOUT: runnerTimeout },
    },
  );

  const session: RunnerSession = {
    device,
    deviceId: device.id,
    port,
    xctestrunPath,
    jsonPath,
    testPromise,
  };
  runnerSessions.set(device.id, session);
  return session;
}


async function ensureXctestrun(
  udid: string,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<string> {
  const base = path.join(os.homedir(), '.agent-device', 'ios-runner');
  const derived = path.join(base, 'derived');
  if (shouldCleanDerived()) {
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
        '-maximum-concurrent-test-simulator-destinations',
        '1',
        '-destination',
        `platform=iOS Simulator,id=${udid}`,
        '-derivedDataPath',
        derived,
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
    throw new AppError('COMMAND_FAILED', 'xcodebuild build-for-testing failed', {
      error: appErr.message,
      details: appErr.details,
      logPath: options.logPath,
    });
  }

  const built = findXctestrun(derived);
  if (!built) {
    throw new AppError('COMMAND_FAILED', 'Failed to locate .xctestrun after build');
  }
  return built;
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

function shouldCleanDerived(): boolean {
  const value = process.env.AGENT_DEVICE_IOS_CLEAN_DERIVED;
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

async function waitForRunner(
  device: DeviceInfo,
  port: number,
  command: RunnerCommand,
  logPath?: string,
): Promise<Response> {
  if (logPath) {
    await waitForRunnerReady(logPath, 4000);
  }
  const start = Date.now();
  let lastError: unknown = null;
  while (Date.now() - start < 8000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      return response;
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (device.kind === 'simulator') {
    const simResponse = await postCommandViaSimulator(device.id, port, command);
    return new Response(simResponse.body, { status: simResponse.status });
  }
  const fallbackPort = logPath ? extractPortFromLog(logPath) : null;
  if (fallbackPort && fallbackPort !== port) {
    try {
      const response = await fetch(`http://127.0.0.1:${fallbackPort}/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(command),
      });
      return response;
    } catch (err) {
      lastError = err;
    }
  }

  throw new AppError('COMMAND_FAILED', 'Runner did not accept connection', {
    port,
    fallbackPort,
    logPath,
    lastError: lastError ? String(lastError) : undefined,
  });
}

async function postCommandViaSimulator(
  udid: string,
  port: number,
  command: RunnerCommand,
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
    { allowFailure: true },
  );
  const body = result.stdout as string;
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Runner did not accept connection (simctl spawn)', {
      port,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
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

async function waitForRunnerReady(logPath: string, timeoutMs: number): Promise<void> {
  if (!fs.existsSync(logPath)) return;
  const start = Date.now();
  let offset = 0;
  while (Date.now() - start < timeoutMs) {
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size > offset) {
      const fd = fs.openSync(logPath, 'r');
      const buffer = Buffer.alloc(stats.size - offset);
      fs.readSync(fd, buffer, 0, buffer.length, offset);
      fs.closeSync(fd);
      offset = stats.size;
      const text = buffer.toString('utf8');
      if (
        text.includes('AGENT_DEVICE_RUNNER_LISTENER_READY') ||
        text.includes('AGENT_DEVICE_RUNNER_PORT=')
      ) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function extractPortFromLog(logPath: string): number | null {
  try {
    if (!fs.existsSync(logPath)) return null;
    const text = fs.readFileSync(logPath, 'utf8');
    const match = text.match(/AGENT_DEVICE_RUNNER_PORT=(\d+)/);
    if (match) return Number(match[1]);
  } catch {
    return null;
  }
  return null;
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
