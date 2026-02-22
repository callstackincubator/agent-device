import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DeviceInfo } from '../utils/device.ts';
import { AppError } from '../utils/errors.ts';
import { runCmd, type ExecResult } from '../utils/exec.ts';
import { readProcessCommand, readProcessStartTime } from '../utils/process-identity.ts';

const DEFAULT_MAX_APP_LOG_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_ROTATED_FILES = 1;
const APP_LOG_PID_FILE = 'app-log.pid';

type StoredAppLogProcessMeta = {
  pid: number;
  startTime?: string;
  command?: string;
};

export type AppLogResult = {
  backend: 'ios-simulator' | 'ios-device' | 'android';
  getState: () => 'active' | 'failed';
  startedAt: number;
  stop: () => Promise<void>;
  wait: Promise<ExecResult>;
};

export type AppLogDoctorResult = {
  checks: Record<string, boolean>;
  notes: string[];
};

function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getAppLogConfig(): { maxBytes: number; maxRotatedFiles: number } {
  return {
    maxBytes: parsePositiveIntEnv('AGENT_DEVICE_APP_LOG_MAX_BYTES', DEFAULT_MAX_APP_LOG_BYTES),
    maxRotatedFiles: parsePositiveIntEnv('AGENT_DEVICE_APP_LOG_MAX_FILES', DEFAULT_MAX_ROTATED_FILES),
  };
}

function getAppLogRedactionPatterns(): RegExp[] {
  const raw = process.env.AGENT_DEVICE_APP_LOG_REDACT_PATTERNS;
  if (!raw) return [];
  const patterns = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const result: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      result.push(new RegExp(pattern, 'gi'));
    } catch {
      // Skip invalid user pattern.
    }
  }
  return result;
}

function parsePidFile(raw: string): StoredAppLogProcessMeta | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { pid: Number.parseInt(trimmed, 10) };
  }
  try {
    const parsed = JSON.parse(trimmed) as StoredAppLogProcessMeta;
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isManagedAppLogCommand(command: string): boolean {
  const normalized = command.toLowerCase().replaceAll('\\', '/');
  return normalized.includes('log stream')
    || normalized.includes('logcat')
    || normalized.includes('devicectl device log stream');
}

function shouldTerminateStoredProcess(meta: StoredAppLogProcessMeta): boolean {
  const currentStartTime = readProcessStartTime(meta.pid);
  if (!currentStartTime) return false;
  if (meta.startTime && currentStartTime !== meta.startTime) return false;
  const currentCommand = readProcessCommand(meta.pid);
  if (!currentCommand || !isManagedAppLogCommand(currentCommand)) return false;
  if (meta.command && currentCommand !== meta.command) return false;
  return true;
}

function writePidFile(pidPath: string | undefined, pid: number): void {
  if (!pidPath) return;
  const dir = path.dirname(pidPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const metadata: StoredAppLogProcessMeta = {
    pid,
    startTime: readProcessStartTime(pid) ?? undefined,
    command: readProcessCommand(pid) ?? undefined,
  };
  fs.writeFileSync(pidPath, `${JSON.stringify(metadata)}\n`);
}

function clearPidFile(pidPath: string | undefined): void {
  if (!pidPath || !fs.existsSync(pidPath)) return;
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // best-effort cleanup
  }
}

function ensureLogPath(outPath: string): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  rotateAppLogIfNeeded(outPath, getAppLogConfig());
}

export function getAppLogPathMetadata(outPath: string): {
  exists: boolean;
  sizeBytes: number;
  modifiedAt?: string;
} {
  if (!fs.existsSync(outPath)) {
    return { exists: false, sizeBytes: 0 };
  }
  const stats = fs.statSync(outPath);
  return {
    exists: true,
    sizeBytes: stats.size,
    modifiedAt: stats.mtime.toISOString(),
  };
}

export function rotateAppLogIfNeeded(
  outPath: string,
  config: { maxBytes: number; maxRotatedFiles: number },
): void {
  if (!fs.existsSync(outPath)) return;
  const stats = fs.statSync(outPath);
  if (stats.size < config.maxBytes) return;

  for (let index = config.maxRotatedFiles; index >= 1; index -= 1) {
    const from = index === 1 ? outPath : `${outPath}.${index - 1}`;
    const to = `${outPath}.${index}`;
    if (!fs.existsSync(from)) continue;
    if (fs.existsSync(to)) fs.unlinkSync(to);
    fs.renameSync(from, to);
  }
}

export function buildIosLogPredicate(appBundleId: string): string {
  return [
    `subsystem == "${appBundleId}"`,
    `processImagePath ENDSWITH[c] "/${appBundleId}"`,
    `senderImagePath ENDSWITH[c] "/${appBundleId}"`,
    `eventMessage CONTAINS[c] "${appBundleId}"`,
  ].join(' OR ');
}

export function buildIosDeviceLogStreamArgs(deviceId: string): string[] {
  return ['devicectl', 'device', 'log', 'stream', '--device', deviceId];
}

export function assertAndroidPackageArgSafe(appBundleId: string): void {
  if (!/^[a-zA-Z0-9._:-]+$/.test(appBundleId)) {
    throw new AppError('INVALID_ARGS', `Invalid Android package name for logs: ${appBundleId}`);
  }
}

async function waitForChildExit(wait: Promise<ExecResult>, timeoutMs = 2_000): Promise<void> {
  await Promise.race([
    wait.then(() => undefined).catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function redactChunk(chunk: string, patterns: RegExp[]): string {
  if (patterns.length === 0) return chunk;
  let output = chunk;
  for (const pattern of patterns) {
    output = output.replace(pattern, '[REDACTED]');
  }
  return output;
}

function createLineWriter(
  stream: fs.WriteStream,
  options: { redactionPatterns: RegExp[]; includeTokens?: string[] },
): { onChunk: (chunk: string) => void; flush: () => void } {
  const includeTokens = options.includeTokens?.filter((token) => token.length > 0) ?? [];
  let pending = '';

  const writeLine = (line: string): void => {
    if (includeTokens.length > 0) {
      const shouldInclude = includeTokens.some((token) => line.includes(token));
      if (!shouldInclude) return;
    }
    stream.write(redactChunk(line, options.redactionPatterns));
  };

  return {
    onChunk: (chunk: string) => {
      const combined = `${pending}${chunk}`;
      const lines = combined.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        writeLine(`${line}\n`);
      }
    },
    flush: () => {
      if (!pending) return;
      writeLine(pending);
      pending = '';
    },
  };
}

function attachChildToStream(
  child: ReturnType<typeof spawn>,
  stream: fs.WriteStream,
  options: { endStreamOnClose: boolean; writer: { onChunk: (chunk: string) => void; flush: () => void } },
): Promise<ExecResult> {
  const stdout = child.stdout;
  const stderr = child.stderr;
  if (!stdout || !stderr) {
    return Promise.resolve({ stdout: '', stderr: 'missing stdio pipes', exitCode: 1 });
  }
  stdout.setEncoding('utf8');
  stderr.setEncoding('utf8');
  stdout.on('data', options.writer.onChunk);
  stderr.on('data', options.writer.onChunk);
  stream.on('error', () => {
    if (!child.killed) child.kill('SIGKILL');
  });
  child.on('error', () => stream.destroy());
  return new Promise<ExecResult>((resolve) => {
    child.on('close', (code) => {
      options.writer.flush();
      if (options.endStreamOnClose) stream.end();
      resolve({ stdout: '', stderr: '', exitCode: code ?? 1 });
    });
  });
}

async function resolveAndroidPid(deviceId: string, appBundleId: string): Promise<string | null> {
  const pidResult = await runCmd('adb', ['-s', deviceId, 'shell', 'pidof', appBundleId], {
    allowFailure: true,
  });
  const pid = pidResult.stdout.trim().split(/\s+/)[0];
  if (!pid || !/^\d+$/.test(pid)) return null;
  return pid;
}

async function startIosAppLog(
  appBundleId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  const child = spawn('log', ['stream', '--style', 'compact', '--predicate', buildIosLogPredicate(appBundleId)], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const writer = createLineWriter(stream, { redactionPatterns });
  if (typeof child.pid === 'number') {
    writePidFile(pidPath, child.pid);
  }
  const wait = attachChildToStream(child, stream, { endStreamOnClose: true, writer }).then((result) => {
    if (result.exitCode !== 0) state = 'failed';
    clearPidFile(pidPath);
    return result;
  });
  return {
    backend: 'ios-simulator',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      if (!child.killed) child.kill('SIGINT');
      await waitForChildExit(wait);
      if (!child.killed) child.kill('SIGKILL');
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}

async function startIosDeviceAppLog(
  deviceId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  const child = spawn('xcrun', buildIosDeviceLogStreamArgs(deviceId), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const writer = createLineWriter(stream, { redactionPatterns });
  if (typeof child.pid === 'number') {
    writePidFile(pidPath, child.pid);
  }
  const wait = attachChildToStream(child, stream, { endStreamOnClose: true, writer }).then((result) => {
    if (result.exitCode !== 0) state = 'failed';
    clearPidFile(pidPath);
    return result;
  });
  return {
    backend: 'ios-device',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      if (!child.killed) child.kill('SIGINT');
      await waitForChildExit(wait);
      if (!child.killed) child.kill('SIGKILL');
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}

async function startAndroidAppLog(
  deviceId: string,
  appBundleId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  let stopped = false;
  let activeChild: ReturnType<typeof spawn> | undefined;
  let activeWait: Promise<ExecResult> | undefined;

  const wait = (async (): Promise<ExecResult> => {
    try {
      while (!stopped) {
        const pid = await resolveAndroidPid(deviceId, appBundleId);
        if (!pid) {
          await sleep(1_000);
          continue;
        }
        const child = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time', '--pid', pid], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        activeChild = child;
        const writer = createLineWriter(stream, { redactionPatterns });
        activeWait = attachChildToStream(child, stream, { endStreamOnClose: false, writer });
        if (typeof child.pid === 'number') {
          writePidFile(pidPath, child.pid);
        }
        const result = await activeWait;
        clearPidFile(pidPath);
        activeChild = undefined;
        activeWait = undefined;
        if (stopped) return { stdout: '', stderr: '', exitCode: 0 };
        if (result.exitCode !== 0) {
          state = 'failed';
        }
        await sleep(500);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    } finally {
      stream.end();
      clearPidFile(pidPath);
    }
  })();

  return {
    backend: 'android',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      stopped = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGINT');
      }
      if (activeWait) await waitForChildExit(activeWait);
      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGKILL');
      }
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}

export async function startAppLog(
  device: DeviceInfo,
  appBundleId: string,
  outPath: string,
  pidPath?: string,
): Promise<AppLogResult> {
  ensureLogPath(outPath);
  const stream = fs.createWriteStream(outPath, { flags: 'a' });
  const redactionPatterns = getAppLogRedactionPatterns();
  if (device.platform === 'ios') {
    if (device.kind === 'device') {
      return await startIosDeviceAppLog(device.id, stream, redactionPatterns, pidPath);
    }
    return await startIosAppLog(appBundleId, stream, redactionPatterns, pidPath);
  }
  if (device.platform === 'android') {
    assertAndroidPackageArgSafe(appBundleId);
    return await startAndroidAppLog(device.id, appBundleId, stream, redactionPatterns, pidPath);
  }
  stream.end();
  throw new AppError('UNSUPPORTED_PLATFORM', `unsupported platform: ${device.platform}`);
}

export async function stopAppLog(appLog: AppLogResult): Promise<void> {
  await appLog.stop();
  await waitForChildExit(appLog.wait);
}

export async function runAppLogDoctor(
  device: DeviceInfo,
  appBundleId?: string,
): Promise<AppLogDoctorResult> {
  const checks: Record<string, boolean> = {};
  const notes: string[] = [];
  if (!appBundleId) {
    notes.push('No app bundle is tracked in this session. Run open <app> first for app-scoped logs.');
  }
  if (device.platform === 'android') {
    try {
      const adb = await runCmd('adb', ['version'], { allowFailure: true });
      checks.adbAvailable = adb.exitCode === 0;
    } catch {
      checks.adbAvailable = false;
    }
    if (appBundleId) {
      try {
        const pidof = await runCmd('adb', ['-s', device.id, 'shell', 'pidof', appBundleId], { allowFailure: true });
        checks.androidPidVisible = pidof.stdout.trim().length > 0;
      } catch {
        checks.androidPidVisible = false;
      }
    }
  }
  if (device.platform === 'ios' && device.kind === 'simulator') {
    try {
      const simctl = await runCmd('xcrun', ['simctl', 'help'], { allowFailure: true });
      checks.simctlAvailable = simctl.exitCode === 0;
    } catch {
      checks.simctlAvailable = false;
    }
  }
  if (device.platform === 'ios' && device.kind === 'device') {
    try {
      const devicectl = await runCmd('xcrun', ['devicectl', '--version'], { allowFailure: true });
      checks.devicectlAvailable = devicectl.exitCode === 0;
    } catch {
      checks.devicectlAvailable = false;
    }
  }
  return { checks, notes };
}

export function cleanupStaleAppLogProcesses(sessionsDir: string): void {
  if (!fs.existsSync(sessionsDir)) return;
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pidPath = path.join(sessionsDir, entry.name, APP_LOG_PID_FILE);
    if (!fs.existsSync(pidPath)) continue;
    try {
      const meta = parsePidFile(fs.readFileSync(pidPath, 'utf8'));
      if (meta && shouldTerminateStoredProcess(meta)) {
        try {
          process.kill(meta.pid, 'SIGTERM');
        } catch {
          // process already gone
        }
      }
    } catch {
      // ignore malformed pid files
    } finally {
      clearPidFile(pidPath);
    }
  }
}

export function appendAppLogMarker(outPath: string, marker: string): void {
  ensureLogPath(outPath);
  const line = `[agent-device][mark][${new Date().toISOString()}] ${marker.trim() || 'marker'}\n`;
  fs.appendFileSync(outPath, line, 'utf8');
}

export const APP_LOG_PID_FILENAME = APP_LOG_PID_FILE;
