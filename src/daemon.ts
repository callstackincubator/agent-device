import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { dispatchCommand, type CommandFlags } from './core/dispatch.ts';
import { isCommandSupportedOnDevice } from './core/capabilities.ts';
import { asAppError, AppError, normalizeError } from './utils/errors.ts';
import { readVersion } from './utils/version.ts';
import { stopAllIosRunnerSessions } from './platforms/ios/runner-client.ts';
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
import {
  isAgentDeviceDaemonProcess,
  readProcessStartTime,
} from './utils/process-identity.ts';
import { emitDiagnostic, flushDiagnosticsToSessionFile, getDiagnosticsMeta, withDiagnosticsScope } from './utils/diagnostics.ts';

const baseDir = path.join(os.homedir(), '.agent-device');
const infoPath = path.join(baseDir, 'daemon.json');
const lockPath = path.join(baseDir, 'daemon.lock');
const logPath = path.join(baseDir, 'daemon.log');
const sessionsDir = path.join(baseDir, 'sessions');
const sessionStore = new SessionStore(sessionsDir);
const version = readVersion();
const token = crypto.randomBytes(24).toString('hex');
const selectorValidationExemptCommands = new Set(['session_list', 'devices']);

type DaemonLockInfo = {
  pid: number;
  version: string;
  startedAt: number;
  processStartTime?: string;
};

const daemonProcessStartTime = readProcessStartTime(process.pid) ?? undefined;

function contextFromFlags(
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
): DaemonCommandContext {
  return contextFromFlagsWithLog(logPath, flags, appBundleId, traceLogPath);
}

async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
  const debug = Boolean(req.meta?.debug || req.flags?.verbose);
  return await withDiagnosticsScope(
    {
      session: req.session,
      requestId: req.meta?.requestId,
      command: req.command,
      debug,
      logPath,
    },
    async () => {
      if (req.token !== token) {
        const unauthorizedError = normalizeError(new AppError('UNAUTHORIZED', 'Invalid token'));
        return { ok: false, error: unauthorizedError };
      }

      emitDiagnostic({
        level: 'info',
        phase: 'request_start',
        data: {
          session: req.session,
          command: req.command,
        },
      });

      try {
        const normalizedReq = normalizeAliasedCommands(req);
        const command = normalizedReq.command;
        const sessionName = resolveEffectiveSessionName(normalizedReq, sessionStore);
        const existingSession = sessionStore.get(sessionName);
        if (existingSession && !selectorValidationExemptCommands.has(command)) {
          assertSessionSelectorMatches(existingSession, normalizedReq.flags);
        }

        const sessionResponse = await handleSessionCommands({
          req: normalizedReq,
          sessionName,
          logPath,
          sessionStore,
          invoke: handleRequest,
        });
        if (sessionResponse) return finalizeDaemonResponse(sessionResponse);

        const snapshotResponse = await handleSnapshotCommands({
          req: normalizedReq,
          sessionName,
          logPath,
          sessionStore,
        });
        if (snapshotResponse) return finalizeDaemonResponse(snapshotResponse);

        const recordTraceResponse = await handleRecordTraceCommands({
          req,
          sessionName,
          sessionStore,
        });
        if (recordTraceResponse) return finalizeDaemonResponse(recordTraceResponse);

        const findResponse = await handleFindCommands({
          req: normalizedReq,
          sessionName,
          logPath,
          sessionStore,
          invoke: handleRequest,
        });
        if (findResponse) return finalizeDaemonResponse(findResponse);

        const interactionResponse = await handleInteractionCommands({
          req: normalizedReq,
          sessionName,
          sessionStore,
          contextFromFlags,
        });
        if (interactionResponse) return finalizeDaemonResponse(interactionResponse);

        const session = sessionStore.get(sessionName);
        if (!session) {
          return finalizeDaemonResponse({
            ok: false,
            error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
          });
        }

        if (!isCommandSupportedOnDevice(command, session.device)) {
          return finalizeDaemonResponse({
            ok: false,
            error: { code: 'UNSUPPORTED_OPERATION', message: `${command} is not supported on this device` },
          });
        }

        const data = await dispatchCommand(session.device, command, normalizedReq.positionals ?? [], normalizedReq.flags?.out, {
          ...contextFromFlags(normalizedReq.flags, session.appBundleId, session.trace?.outPath),
        });
        sessionStore.recordAction(session, {
          command,
          positionals: normalizedReq.positionals ?? [],
          flags: normalizedReq.flags ?? {},
          result: data ?? {},
        });
        return finalizeDaemonResponse({ ok: true, data: data ?? {} });
      } catch (error) {
        emitDiagnostic({
          level: 'error',
          phase: 'request_failed',
          data: {
            error: error instanceof Error ? error.message : String(error),
          },
        });
        const details = getDiagnosticsMeta();
        const logPathOnFailure = flushDiagnosticsToSessionFile({ force: true }) ?? undefined;
        const normalizedError = normalizeError(error, {
          diagnosticId: details.diagnosticId,
          logPath: logPathOnFailure,
        });
        return { ok: false, error: normalizedError };
      }
    },
  );
}

function finalizeDaemonResponse(response: DaemonResponse): DaemonResponse {
  const details = getDiagnosticsMeta();
  if (!response.ok) {
    emitDiagnostic({
      level: 'error',
      phase: 'request_failed',
      data: {
        code: response.error.code,
        message: response.error.message,
      },
    });
    const logPathOnFailure = flushDiagnosticsToSessionFile({ force: true }) ?? undefined;
    const normalizedError = normalizeError(
      new AppError(response.error.code as any, response.error.message, {
        ...(response.error.details ?? {}),
        hint: response.error.hint,
        diagnosticId: response.error.diagnosticId,
        logPath: response.error.logPath,
      }),
      {
        diagnosticId: details.diagnosticId,
        logPath: logPathOnFailure,
      },
    );
    return { ok: false, error: normalizedError };
  }
  emitDiagnostic({ level: 'info', phase: 'request_success' });
  flushDiagnosticsToSessionFile();
  return response;
}

function normalizeAliasedCommands(req: DaemonRequest): DaemonRequest {
  if (req.command !== 'click') return req;
  return { ...req, command: 'press' };
}

function writeInfo(port: number): void {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(logPath, '');
  fs.writeFileSync(
    infoPath,
    JSON.stringify({ port, token, pid: process.pid, version, processStartTime: daemonProcessStartTime }, null, 2),
    {
      mode: 0o600,
    },
  );
}

function removeInfo(): void {
  if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
}

function readLockInfo(): DaemonLockInfo | null {
  if (!fs.existsSync(lockPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as DaemonLockInfo;
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function acquireDaemonLock(): boolean {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  const lockData: DaemonLockInfo = {
    pid: process.pid,
    version,
    startedAt: Date.now(),
    processStartTime: daemonProcessStartTime,
  };
  const payload = JSON.stringify(lockData, null, 2);

  const tryWriteLock = (): boolean => {
    try {
      fs.writeFileSync(lockPath, payload, { flag: 'wx', mode: 0o600 });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
      throw err;
    }
  };

  if (tryWriteLock()) return true;
  const existing = readLockInfo();
  if (
    existing?.pid
    && existing.pid !== process.pid
    && isAgentDeviceDaemonProcess(existing.pid, existing.processStartTime)
  ) {
    return false;
  }
  // Best-effort stale-lock cleanup: another process may win the race between unlink and re-create.
  // We rely on the subsequent write with `wx` to enforce single-writer semantics.
  try {
    fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
  return tryWriteLock();
}

function releaseDaemonLock(): void {
  const existing = readLockInfo();
  if (existing && existing.pid !== process.pid) return;
  try {
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  } catch {
    // ignore
  }
}

function start(): void {
  if (!acquireDaemonLock()) {
    process.stderr.write('Daemon lock is held by another process; exiting.\n');
    process.exit(0);
    return;
  }

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
          response = { ok: false, error: normalizeError(err) };
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

  let shuttingDown = false;
  const closeServer = async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      try {
        server.close(() => resolve());
      } catch {
        resolve();
      }
    });
  };
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeServer();
    const sessionsToStop = sessionStore.toArray();
    for (const session of sessionsToStop) {
      sessionStore.writeSessionLog(session);
    }
    await stopAllIosRunnerSessions();
    removeInfo();
    releaseDaemonLock();
    process.exit(0);
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
