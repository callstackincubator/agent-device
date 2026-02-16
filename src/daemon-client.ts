import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from './utils/errors.ts';
import type { CommandFlags } from './core/dispatch.ts';
import { runCmdDetached } from './utils/exec.ts';
import { findProjectRoot, readVersion } from './utils/version.ts';
import {
  isAgentDeviceDaemonProcess,
  stopProcessForTakeover,
} from './utils/process-identity.ts';

export type DaemonRequest = {
  token: string;
  session: string;
  command: string;
  positionals: string[];
  flags?: CommandFlags;
};

export type DaemonResponse =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

type DaemonInfo = {
  port: number;
  token: string;
  pid: number;
  version?: string;
  processStartTime?: string;
};

type DaemonLockInfo = {
  pid: number;
  processStartTime?: string;
  startedAt?: number;
};

type DaemonMetadataState = {
  hasInfo: boolean;
  hasLock: boolean;
};

const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const lockPath = path.join(baseDir, 'daemon.lock');
const REQUEST_TIMEOUT_MS = resolveDaemonRequestTimeoutMs();
const DAEMON_STARTUP_TIMEOUT_MS = 5000;
const DAEMON_TAKEOVER_TERM_TIMEOUT_MS = 3000;
const DAEMON_TAKEOVER_KILL_TIMEOUT_MS = 1000;

export async function sendToDaemon(req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> {
  const info = await ensureDaemon();
  const request = { ...req, token: info.token };
  return await sendRequest(info, request);
}

async function ensureDaemon(): Promise<DaemonInfo> {
  const existing = readDaemonInfo();
  const localVersion = readVersion();
  const existingReachable = existing ? await canConnect(existing) : false;
  if (existing && existing.version === localVersion && existingReachable) return existing;
  if (existing && (existing.version !== localVersion || !existingReachable)) {
    await stopDaemonProcessForTakeover(existing);
    removeDaemonInfo();
  }

  cleanupStaleDaemonLockIfSafe();
  await startDaemon();
  const started = await waitForDaemonInfo(DAEMON_STARTUP_TIMEOUT_MS);
  if (started) return started;

  if (await recoverDaemonLockHolder()) {
    await startDaemon();
    const recovered = await waitForDaemonInfo(DAEMON_STARTUP_TIMEOUT_MS);
    if (recovered) return recovered;
  }

  throw new AppError('COMMAND_FAILED', 'Failed to start daemon', {
    kind: 'daemon_startup_failed',
    infoPath,
    lockPath,
    hint: resolveDaemonStartupHint(getDaemonMetadataState()),
  });
}

async function waitForDaemonInfo(timeoutMs: number): Promise<DaemonInfo | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = readDaemonInfo();
    if (info && (await canConnect(info))) return info;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function recoverDaemonLockHolder(): Promise<boolean> {
  const state = getDaemonMetadataState();
  if (!state.hasLock || state.hasInfo) return false;
  const lockInfo = readDaemonLockInfo();
  if (!lockInfo) {
    removeDaemonLock();
    return true;
  }
  if (!isAgentDeviceDaemonProcess(lockInfo.pid, lockInfo.processStartTime)) {
    removeDaemonLock();
    return true;
  }
  await stopProcessForTakeover(lockInfo.pid, {
    termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
    killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
    expectedStartTime: lockInfo.processStartTime,
  });
  removeDaemonLock();
  return true;
}

async function stopDaemonProcessForTakeover(info: DaemonInfo): Promise<void> {
  await stopProcessForTakeover(info.pid, {
    termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
    killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
    expectedStartTime: info.processStartTime,
  });
}

function readDaemonInfo(): DaemonInfo | null {
  const data = readJsonFile(infoPath) as DaemonInfo | null;
  if (!data || !data.port || !data.token) return null;
  return {
    ...data,
    pid: Number.isInteger(data.pid) && data.pid > 0 ? data.pid : 0,
  };
}

function readDaemonLockInfo(): DaemonLockInfo | null {
  const data = readJsonFile(lockPath) as DaemonLockInfo | null;
  if (!data || !Number.isInteger(data.pid) || data.pid <= 0) {
    return null;
  }
  return data;
}

function removeDaemonInfo(): void {
  removeFileIfExists(infoPath);
}

function removeDaemonLock(): void {
  removeFileIfExists(lockPath);
}

function cleanupStaleDaemonLockIfSafe(): void {
  const state = getDaemonMetadataState();
  if (!state.hasLock || state.hasInfo) return;
  const lockInfo = readDaemonLockInfo();
  if (!lockInfo) {
    removeDaemonLock();
    return;
  }
  if (isAgentDeviceDaemonProcess(lockInfo.pid, lockInfo.processStartTime)) {
    return;
  }
  removeDaemonLock();
}

function getDaemonMetadataState(): DaemonMetadataState {
  return {
    hasInfo: fs.existsSync(infoPath),
    hasLock: fs.existsSync(lockPath),
  };
}

function readJsonFile(filePath: string): unknown | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as unknown;
  } catch {
    return null;
  }
}

function removeFileIfExists(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup only.
  }
}

async function canConnect(info: DaemonInfo): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: info.port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

async function startDaemon(): Promise<void> {
  const root = findProjectRoot();
  const distPath = path.join(root, 'dist', 'src', 'daemon.js');
  const srcPath = path.join(root, 'src', 'daemon.ts');

  const hasDist = fs.existsSync(distPath);
  const hasSrc = fs.existsSync(srcPath);
  if (!hasDist && !hasSrc) {
    throw new AppError('COMMAND_FAILED', 'Daemon entry not found', { distPath, srcPath });
  }
  const runningFromSource = process.execArgv.includes('--experimental-strip-types');
  const useSrc = runningFromSource ? hasSrc : !hasDist && hasSrc;
  const args = useSrc ? ['--experimental-strip-types', srcPath] : [distPath];

  runCmdDetached(process.execPath, args);
}

async function sendRequest(info: DaemonInfo, req: DaemonRequest): Promise<DaemonResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port: info.port }, () => {
      socket.write(`${JSON.stringify(req)}\n`);
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(
        new AppError('COMMAND_FAILED', 'Daemon request timed out', { timeoutMs: REQUEST_TIMEOUT_MS }),
      );
    }, REQUEST_TIMEOUT_MS);

    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      const idx = buffer.indexOf('\n');
      if (idx === -1) return;
      const line = buffer.slice(0, idx).trim();
      if (!line) return;
      try {
        const response = JSON.parse(line) as DaemonResponse;
        socket.end();
        clearTimeout(timeout);
        resolve(response);
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export function resolveDaemonRequestTimeoutMs(raw: string | undefined = process.env.AGENT_DEVICE_DAEMON_TIMEOUT_MS): number {
  if (!raw) return 90000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 90000;
  return Math.max(1000, Math.floor(parsed));
}

export function resolveDaemonStartupHint(state: { hasInfo: boolean; hasLock: boolean }): string {
  if (state.hasLock && !state.hasInfo) {
    return 'Detected ~/.agent-device/daemon.lock without daemon.json. If no agent-device daemon process is running, delete ~/.agent-device/daemon.lock and retry.';
  }
  if (state.hasLock && state.hasInfo) {
    return 'Daemon metadata may be stale. If no agent-device daemon process is running, delete ~/.agent-device/daemon.json and ~/.agent-device/daemon.lock, then retry.';
  }
  return 'Daemon metadata is missing or stale. Delete ~/.agent-device/daemon.json if present and retry.';
}
