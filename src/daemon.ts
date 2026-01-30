import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dispatchCommand, resolveTargetDevice, type CommandFlags } from './core/dispatch.ts';
import { asAppError, AppError } from './utils/errors.ts';
import type { DeviceInfo } from './utils/device.ts';

type DaemonRequest = {
  token: string;
  session: string;
  command: string;
  positionals: string[];
  flags?: CommandFlags;
};

type DaemonResponse =
  | { ok: true; data?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } };

type SessionState = {
  name: string;
  device: DeviceInfo;
  createdAt: number;
  appBundleId?: string;
};

const sessions = new Map<string, SessionState>();
const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const logPath = path.join(baseDir, 'daemon.log');
const version = readVersion();
const token = crypto.randomBytes(24).toString('hex');

async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
  if (req.token !== token) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } };
  }

  const command = req.command;
  const sessionName = req.session || 'default';

  if (command === 'session_list') {
    const data = {
      sessions: Array.from(sessions.values()).map((s) => ({
        name: s.name,
        platform: s.device.platform,
        device: s.device.name,
        id: s.device.id,
        createdAt: s.createdAt,
      })),
    };
    return { ok: true, data };
  }

  if (command === 'open') {
    const device = await resolveTargetDevice(req.flags ?? {});
    let appBundleId: string | undefined;
    if (device.platform === 'ios') {
      try {
        const { resolveIosApp } = await import('./platforms/ios/index.ts');
        appBundleId = await resolveIosApp(device, req.positionals?.[0] ?? '');
      } catch {
        appBundleId = undefined;
      }
    }
    await dispatchCommand(device, 'open', req.positionals ?? [], req.flags?.out, {
      appBundleId,
      verbose: req.flags?.verbose,
      logPath,
    });
    sessions.set(sessionName, {
      name: sessionName,
      device,
      createdAt: Date.now(),
      appBundleId,
    });
    return { ok: true, data: { session: sessionName } };
  }

  if (command === 'close') {
    const session = sessions.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (req.positionals && req.positionals.length > 0) {
      await dispatchCommand(session.device, 'close', req.positionals ?? [], req.flags?.out, {
        appBundleId: session.appBundleId,
        verbose: req.flags?.verbose,
        logPath,
      });
    }
    sessions.delete(sessionName);
    return { ok: true, data: { session: sessionName } };
  }

  const session = sessions.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }

  const data = await dispatchCommand(session.device, command, req.positionals ?? [], req.flags?.out, {
    appBundleId: session.appBundleId,
    verbose: req.flags?.verbose,
    logPath,
  });
  return { ok: true, data: data ?? {} };
}

function writeInfo(port: number): void {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(
    infoPath,
    JSON.stringify({ port, token, pid: process.pid, version }, null, 2),
    {
      mode: 0o600,
    },
  );
}

function removeInfo(): void {
  if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
}

function start(): void {
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', async (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length === 0) {
          idx = buffer.indexOf('\n');
          continue;
        }
        let response: DaemonResponse;
        try {
          const req = JSON.parse(line) as DaemonRequest;
          response = await handleRequest(req);
        } catch (err) {
          const appErr = asAppError(err);
          response = { ok: false, error: { code: appErr.code, message: appErr.message } };
        }
        socket.write(`${JSON.stringify(response)}\n`);
        idx = buffer.indexOf('\n');
      }
    });
  });

  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (typeof address === 'object' && address?.port) {
      writeInfo(address.port);
      process.stdout.write(`AGENT_DEVICE_DAEMON_PORT=${address.port}\n`);
    }
  });

  const shutdown = () => {
    server.close(() => {
      removeInfo();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('uncaughtException', (err) => {
    const appErr = err instanceof AppError ? err : asAppError(err);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    shutdown();
  });
}

start();

function readVersion(): string {
  try {
    const root = findProjectRoot();
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
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
