import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dispatchCommand, type CommandFlags } from './core/dispatch.ts';
import { isCommandSupportedOnDevice } from './core/capabilities.ts';
import { asAppError, AppError } from './utils/errors.ts';
import { readVersion } from './utils/version.ts';
import { stopIosRunnerSession } from './platforms/ios/runner-client.ts';
import type { DaemonRequest, DaemonResponse } from './daemon/types.ts';
import { SessionStore } from './daemon/session-store.ts';
import { contextFromFlags as contextFromFlagsWithLog, type DaemonCommandContext } from './daemon/context.ts';
import { handleSessionCommands } from './daemon/handlers/session.ts';
import { handleSnapshotCommands } from './daemon/handlers/snapshot.ts';
import { handleFindCommands } from './daemon/handlers/find.ts';
import { handleRecordTraceCommands } from './daemon/handlers/record-trace.ts';
import { handleInteractionCommands } from './daemon/handlers/interaction.ts';
import { assertSessionSelectorMatches } from './daemon/session-selector.ts';
import { resolveEffectiveSessionName } from './daemon/session-routing.ts';

const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const logPath = path.join(baseDir, 'daemon.log');
const sessionsDir = path.join(baseDir, 'sessions');
const sessionStore = new SessionStore(sessionsDir);
const version = readVersion();
const token = crypto.randomBytes(24).toString('hex');
const selectorValidationExemptCommands = new Set(['session_list', 'devices']);

function contextFromFlags(
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
): DaemonCommandContext {
  return contextFromFlagsWithLog(logPath, flags, appBundleId, traceLogPath);
}

async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
  if (req.token !== token) {
    return { ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid token' } };
  }

  const command = req.command;
  const sessionName = resolveEffectiveSessionName(req, sessionStore);
  const existingSession = sessionStore.get(sessionName);
  if (existingSession && !selectorValidationExemptCommands.has(command)) {
    assertSessionSelectorMatches(existingSession, req.flags);
  }

  const sessionResponse = await handleSessionCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke: handleRequest,
  });
  if (sessionResponse) return sessionResponse;

  const snapshotResponse = await handleSnapshotCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
  });
  if (snapshotResponse) return snapshotResponse;

  const recordTraceResponse = await handleRecordTraceCommands({
    req,
    sessionName,
    sessionStore,
  });
  if (recordTraceResponse) return recordTraceResponse;

  const findResponse = await handleFindCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke: handleRequest,
  });
  if (findResponse) return findResponse;

  const interactionResponse = await handleInteractionCommands({
    req,
    sessionName,
    sessionStore,
    contextFromFlags,
  });
  if (interactionResponse) return interactionResponse;


  const session = sessionStore.get(sessionName);
  if (!session) {
    return {
      ok: false,
      error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
    };
  }

  if (!isCommandSupportedOnDevice(command, session.device)) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_OPERATION', message: `${command} is not supported on this device` },
    };
  }

  const data = await dispatchCommand(session.device, command, req.positionals ?? [], req.flags?.out, {
    ...contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
  });
  sessionStore.recordAction(session, {
    command,
    positionals: req.positionals ?? [],
    flags: req.flags ?? {},
    result: data ?? {},
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
          response = {
            ok: false,
            error: { code: appErr.code, message: appErr.message, details: appErr.details },
          };
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

  const shutdown = async () => {
    const sessionsToStop = sessionStore.toArray();
    for (const session of sessionsToStop) {
      if (session.device.platform === 'ios' && session.device.kind === 'simulator') {
        await stopIosRunnerSession(session.device.id);
      }
      sessionStore.writeSessionLog(session);
    }
    server.close(() => {
      removeInfo();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGHUP', () => {
    void shutdown();
  });
  process.on('uncaughtException', (err) => {
    const appErr = err instanceof AppError ? err : asAppError(err);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    void shutdown();
  });
}

start();
