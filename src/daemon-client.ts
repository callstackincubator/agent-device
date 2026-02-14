import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AppError } from './utils/errors.ts';
import type { CommandFlags } from './core/dispatch.ts';
import { runCmdDetached } from './utils/exec.ts';
import { findProjectRoot, readVersion } from './utils/version.ts';

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

type DaemonInfo = { port: number; token: string; pid: number; version?: string };

const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const REQUEST_TIMEOUT_MS = resolveRequestTimeoutMs();
const DAEMON_STARTUP_TIMEOUT_MS = 5000;

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
    removeDaemonInfo();
  }

  await startDaemon();

  const start = Date.now();
  while (Date.now() - start < DAEMON_STARTUP_TIMEOUT_MS) {
    const info = readDaemonInfo();
    if (info && (await canConnect(info))) return info;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new AppError('COMMAND_FAILED', 'Failed to start daemon', {
    infoPath,
    hint: 'Run pnpm build, or delete ~/.agent-device/daemon.json if stale.',
  });
}

function readDaemonInfo(): DaemonInfo | null {
  if (!fs.existsSync(infoPath)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(infoPath, 'utf8')) as DaemonInfo;
    if (!data.port || !data.token) return null;
    return data;
  } catch {
    return null;
  }
}

function removeDaemonInfo(): void {
  try {
    if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
  } catch {
    // Best-effort cleanup only; daemon can still overwrite this file on startup.
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

function resolveRequestTimeoutMs(): number {
  const raw = process.env.AGENT_DEVICE_DAEMON_TIMEOUT_MS;
  if (!raw) return 60000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 60000;
  return Math.max(1000, Math.floor(parsed));
}
