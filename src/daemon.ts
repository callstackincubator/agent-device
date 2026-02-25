import net from 'node:net';
import type { Server as HttpServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { dispatchCommand, type CommandFlags } from './core/dispatch.ts';
import { isCommandSupportedOnDevice } from './core/capabilities.ts';
import { asAppError, AppError, normalizeError } from './utils/errors.ts';
import { findProjectRoot, readVersion } from './utils/version.ts';
import { abortAllIosRunnerSessions, stopAllIosRunnerSessions } from './platforms/ios/runner-client.ts';
import type { DaemonRequest, DaemonResponse } from './daemon/types.ts';
import { SessionStore } from './daemon/session-store.ts';
import { contextFromFlags as contextFromFlagsWithLog, type DaemonCommandContext } from './daemon/context.ts';
import { handleSessionCommands } from './daemon/handlers/session.ts';
import { handleSnapshotCommands } from './daemon/handlers/snapshot.ts';
import { handleFindCommands } from './daemon/handlers/find.ts';
import { handleRecordTraceCommands } from './daemon/handlers/record-trace.ts';
import { handleInteractionCommands } from './daemon/handlers/interaction.ts';
import { handleLeaseCommands } from './daemon/handlers/lease.ts';
import { cleanupStaleAppLogProcesses } from './daemon/app-log.ts';
import { assertSessionSelectorMatches } from './daemon/session-selector.ts';
import { resolveEffectiveSessionName } from './daemon/session-routing.ts';
import { clearRequestCanceled, isRequestCanceled, markRequestCanceled } from './daemon/request-cancel.ts';
import {
  isAgentDeviceDaemonProcess,
  readProcessStartTime,
} from './utils/process-identity.ts';
import { emitDiagnostic, flushDiagnosticsToSessionFile, getDiagnosticsMeta, withDiagnosticsScope } from './utils/diagnostics.ts';
import {
  normalizeTenantId,
  resolveDaemonPaths,
  resolveDaemonServerMode,
  resolveSessionIsolationMode,
} from './daemon/config.ts';
import { createDaemonHttpServer } from './daemon/http-server.ts';
import { LeaseRegistry } from './daemon/lease-registry.ts';
import { resolveLeaseScope } from './daemon/lease-context.ts';

const daemonPaths = resolveDaemonPaths(process.env.AGENT_DEVICE_STATE_DIR);
const { baseDir, infoPath, lockPath, logPath, sessionsDir } = daemonPaths;
const daemonServerMode = resolveDaemonServerMode(process.env.AGENT_DEVICE_DAEMON_SERVER_MODE);
cleanupStaleAppLogProcesses(sessionsDir);
const sessionStore = new SessionStore(sessionsDir);
const leaseRegistry = new LeaseRegistry({
  maxActiveSimulatorLeases: parseIntegerEnv(process.env.AGENT_DEVICE_MAX_SIMULATOR_LEASES),
  defaultLeaseTtlMs: parseIntegerEnv(process.env.AGENT_DEVICE_LEASE_TTL_MS),
  minLeaseTtlMs: parseIntegerEnv(process.env.AGENT_DEVICE_LEASE_MIN_TTL_MS),
  maxLeaseTtlMs: parseIntegerEnv(process.env.AGENT_DEVICE_LEASE_MAX_TTL_MS),
});
const version = readVersion();
const token = crypto.randomBytes(24).toString('hex');
const selectorValidationExemptCommands = new Set(['session_list', 'devices']);
const leaseAdmissionExemptCommands = new Set([
  'session_list',
  'devices',
  'lease_allocate',
  'lease_heartbeat',
  'lease_release',
]);
const disconnectAbortPollIntervalMs = 200;
const disconnectAbortMaxWindowMs = 15_000;

type DaemonLockInfo = {
  pid: number;
  version: string;
  startedAt: number;
  processStartTime?: string;
};

const daemonProcessStartTime = readProcessStartTime(process.pid) ?? undefined;
const daemonCodeSignature = resolveDaemonCodeSignature();

function contextFromFlags(
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
): DaemonCommandContext {
  const requestId = getDiagnosticsMeta().requestId;
  return {
    ...contextFromFlagsWithLog(logPath, flags, appBundleId, traceLogPath, requestId),
    requestId,
  };
}

function scopeRequestSession(req: DaemonRequest): DaemonRequest {
  const isolation = resolveSessionIsolationMode(req.meta?.sessionIsolation ?? req.flags?.sessionIsolation);
  const rawTenant = req.meta?.tenantId ?? req.flags?.tenant;
  const tenant = normalizeTenantId(rawTenant);

  if (rawTenant && !tenant) {
    throw new AppError('INVALID_ARGS', 'Invalid tenant id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.');
  }
  if (isolation !== 'tenant') {
    return req;
  }
  if (!tenant) {
    throw new AppError('INVALID_ARGS', 'session isolation mode tenant requires --tenant (or meta.tenantId).');
  }
  return {
    ...req,
    session: `${tenant}:${req.session || 'default'}`,
    meta: {
      ...req.meta,
      tenantId: tenant,
      sessionIsolation: isolation,
    },
  };
}

async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
  const normalizedReq = normalizeAliasedCommands(req);
  const debug = Boolean(normalizedReq.meta?.debug || normalizedReq.flags?.verbose);
  return await withDiagnosticsScope(
    {
      session: normalizedReq.session,
      requestId: normalizedReq.meta?.requestId,
      command: normalizedReq.command,
      debug,
      logPath,
    },
    async () => {
      if (normalizedReq.token !== token) {
        const unauthorizedError = normalizeError(new AppError('UNAUTHORIZED', 'Invalid token'));
        return { ok: false, error: unauthorizedError };
      }

      try {
        const scopedReq = scopeRequestSession(normalizedReq);
        emitDiagnostic({
          level: 'info',
          phase: 'request_start',
          data: {
            session: scopedReq.session,
            command: scopedReq.command,
            tenant: scopedReq.meta?.tenantId,
            isolation: scopedReq.meta?.sessionIsolation,
          },
        });

        const command = scopedReq.command;
        const leaseScope = resolveLeaseScope(scopedReq);
        if (!leaseAdmissionExemptCommands.has(command) && scopedReq.meta?.sessionIsolation === 'tenant') {
          leaseRegistry.assertLeaseAdmission({
            tenantId: leaseScope.tenantId,
            runId: leaseScope.runId,
            leaseId: leaseScope.leaseId,
            backend: leaseScope.leaseBackend,
          });
        }
        const sessionName = resolveEffectiveSessionName(scopedReq, sessionStore);
        const existingSession = sessionStore.get(sessionName);
        if (existingSession && !selectorValidationExemptCommands.has(command)) {
          assertSessionSelectorMatches(existingSession, scopedReq.flags);
        }

        const leaseResponse = await handleLeaseCommands({
          req: scopedReq,
          leaseRegistry,
        });
        if (leaseResponse) return finalizeDaemonResponse(leaseResponse);

        const sessionResponse = await handleSessionCommands({
          req: scopedReq,
          sessionName,
          logPath,
          sessionStore,
          invoke: handleRequest,
        });
        if (sessionResponse) return finalizeDaemonResponse(sessionResponse);

        const snapshotResponse = await handleSnapshotCommands({
          req: scopedReq,
          sessionName,
          logPath,
          sessionStore,
        });
        if (snapshotResponse) return finalizeDaemonResponse(snapshotResponse);

        const recordTraceResponse = await handleRecordTraceCommands({
          req: scopedReq,
          sessionName,
          sessionStore,
          logPath,
        });
        if (recordTraceResponse) return finalizeDaemonResponse(recordTraceResponse);

        const findResponse = await handleFindCommands({
          req: scopedReq,
          sessionName,
          logPath,
          sessionStore,
          invoke: handleRequest,
        });
        if (findResponse) return finalizeDaemonResponse(findResponse);

        const interactionResponse = await handleInteractionCommands({
          req: scopedReq,
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

        const data = await dispatchCommand(session.device, command, scopedReq.positionals ?? [], scopedReq.flags?.out, {
          ...contextFromFlags(scopedReq.flags, session.appBundleId, session.trace?.outPath),
        });
        sessionStore.recordAction(session, {
          command,
          positionals: scopedReq.positionals ?? [],
          flags: scopedReq.flags ?? {},
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
  if (req.command === 'click') {
    return { ...req, command: 'press' };
  }
  return req;
}

function writeInfo(ports: { socketPort?: number; httpPort?: number }): void {
  if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(logPath, '');
  const transport = ports.httpPort && ports.socketPort
    ? 'dual'
    : ports.httpPort
      ? 'http'
      : 'socket';
  fs.writeFileSync(
    infoPath,
    JSON.stringify(
      {
        port: ports.socketPort,
        httpPort: ports.httpPort,
        transport,
        token,
        pid: process.pid,
        version,
        codeSignature: daemonCodeSignature,
        processStartTime: daemonProcessStartTime,
        stateDir: baseDir,
      },
      null,
      2,
    ),
    {
      mode: 0o600,
    },
  );
}

function resolveDaemonCodeSignature(): string {
  const entryPath = process.argv[1];
  if (!entryPath) return 'unknown';
  try {
    const stat = fs.statSync(entryPath);
    const root = findProjectRoot();
    const relativePath = path.relative(root, entryPath) || entryPath;
    return `${relativePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return 'unknown';
  }
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

function createSocketServer(): net.Server {
  return net.createServer((socket) => {
    let buffer = '';
    let inFlightRequests = 0;
    const activeRequestIds = new Set<string>();
    let canceledInFlight = false;
    const cancelInFlightRunnerSessions = () => {
      if (canceledInFlight || inFlightRequests === 0) return;
      canceledInFlight = true;
      for (const requestId of activeRequestIds) {
        markRequestCanceled(requestId);
      }
      emitDiagnostic({
        level: 'warn',
        phase: 'request_client_disconnected',
        data: {
          inFlightRequests,
        },
      });
      void (async () => {
        const deadline = Date.now() + disconnectAbortMaxWindowMs;
        while (inFlightRequests > 0 && Date.now() < deadline) {
          await abortAllIosRunnerSessions();
          if (inFlightRequests <= 0) break;
          await sleep(disconnectAbortPollIntervalMs);
        }
      })();
    };
    socket.setEncoding('utf8');
    socket.on('close', cancelInFlightRunnerSessions);
    socket.on('error', cancelInFlightRunnerSessions);
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
        inFlightRequests += 1;
        let requestIdForCleanup: string | undefined;
        try {
          const req = JSON.parse(line) as DaemonRequest;
          requestIdForCleanup = req.meta?.requestId;
          if (requestIdForCleanup) {
            activeRequestIds.add(requestIdForCleanup);
            if (isRequestCanceled(requestIdForCleanup)) {
              throw new AppError('COMMAND_FAILED', 'request canceled');
            }
          }
          response = await handleRequest(req);
        } catch (err) {
          response = { ok: false, error: normalizeError(err) };
        } finally {
          inFlightRequests -= 1;
          if (requestIdForCleanup) {
            activeRequestIds.delete(requestIdForCleanup);
            clearRequestCanceled(requestIdForCleanup);
          }
        }
        if (!socket.destroyed) {
          socket.write(`${JSON.stringify(response)}\n`);
        }
        idx = buffer.indexOf('\n');
      }
    });
  });
}

function listenNetServer(server: net.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
        return;
      }
      reject(new AppError('COMMAND_FAILED', 'Failed to bind socket server'));
    });
  });
}

function listenHttpServer(server: HttpServer): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
        return;
      }
      reject(new AppError('COMMAND_FAILED', 'Failed to bind HTTP server'));
    });
  });
}

async function start(): Promise<void> {
  if (!acquireDaemonLock()) {
    process.stderr.write('Daemon lock is held by another process; exiting.\n');
    process.exit(0);
    return;
  }

  const servers: Array<{ close: (cb: (err?: Error) => void) => void }> = [];
  let socketPort: number | undefined;
  let httpPort: number | undefined;

  try {
    if (daemonServerMode === 'socket' || daemonServerMode === 'dual') {
      const socketServer = createSocketServer();
      servers.push(socketServer);
      socketPort = await listenNetServer(socketServer);
    }

    if (daemonServerMode === 'http' || daemonServerMode === 'dual') {
      const httpServer = await createDaemonHttpServer({ handleRequest });
      servers.push(httpServer);
      httpPort = await listenHttpServer(httpServer);
    }

    writeInfo({ socketPort, httpPort });
    if (socketPort) process.stdout.write(`AGENT_DEVICE_DAEMON_PORT=${socketPort}\n`);
    if (httpPort) process.stdout.write(`AGENT_DEVICE_DAEMON_HTTP_PORT=${httpPort}\n`);
  } catch (error) {
    const appErr = asAppError(error);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    for (const server of servers) {
      try {
        server.close(() => {});
      } catch {
        // ignore
      }
    }
    removeInfo();
    releaseDaemonLock();
    process.exit(1);
    return;
  }

  let shuttingDown = false;
  const closeServers = async (): Promise<void> => {
    await Promise.all(
      servers.map(async (server) => {
        await new Promise<void>((resolve) => {
          try {
            server.close(() => resolve());
          } catch {
            resolve();
          }
        });
      }),
    );
  };
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeServers();
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

void start();

function parseIntegerEnv(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value)) return undefined;
  return value;
}
