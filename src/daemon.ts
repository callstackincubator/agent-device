import crypto from 'node:crypto';
import { asAppError, AppError } from './utils/errors.ts';
import { stopAllIosRunnerSessions } from './platforms/ios/runner-client.ts';
import { SessionStore } from './daemon/session-store.ts';
import { cleanupStaleAppLogProcesses } from './daemon/app-log.ts';
import { resolveDaemonPaths, resolveDaemonServerMode } from './daemon/config.ts';
import { createDaemonHttpServer } from './daemon/http-server.ts';
import { trackDownloadableArtifact } from './daemon/artifact-tracking.ts';
import { LeaseRegistry } from './daemon/lease-registry.ts';
import { createRequestHandler } from './daemon/request-router.ts';
import { teardownSessionResources } from './daemon/handlers/session-close.ts';
import { closeDaemonServers } from './daemon/server-shutdown.ts';
import type { SessionState } from './daemon/types.ts';
import {
  emitDiagnostic,
  flushDiagnosticsToSessionFile,
  withDiagnosticsScope,
} from './utils/diagnostics.ts';
import {
  acquireDaemonLock,
  parseIntegerEnv,
  readProcessStartTime,
  readVersion,
  releaseDaemonLock,
  removeInfo,
  resolveDaemonCodeSignature,
  writeInfo,
} from './daemon/server-lifecycle.ts';
import {
  createSocketServer,
  listenHttpServer,
  listenNetServer,
  type DaemonServer,
} from './daemon/transport.ts';
import { sleep } from './utils/timeouts.ts';

const DAEMON_SESSION_TEARDOWN_TIMEOUT_MS = 5_000;

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
const daemonProcessStartTime = readProcessStartTime(process.pid) ?? undefined;
const daemonCodeSignature = resolveDaemonCodeSignature();

const handleRequest = createRequestHandler({
  logPath,
  token,
  sessionStore,
  leaseRegistry,
  trackDownloadableArtifact,
});

async function emitFatalDiagnostic(error: unknown): Promise<void> {
  await withDiagnosticsScope(
    { command: 'daemon', session: 'daemon', logPath, debug: true },
    async () => {
      emitDiagnostic({
        level: 'error',
        phase: 'daemon_fatal',
        data: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
      flushDiagnosticsToSessionFile({ force: true });
    },
  );
}

async function teardownDaemonSessions(): Promise<void> {
  const sessionsToStop = sessionStore.toArray();
  await Promise.all(sessionsToStop.map(teardownDaemonSession));
}

async function teardownDaemonSession(session: SessionState) {
  const teardown = teardownSessionResources(session, session.name).catch((error) => {
    process.stderr.write(
      `Daemon session teardown error (${session.name}): ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  });
  await Promise.race([
    teardown,
    sleep(DAEMON_SESSION_TEARDOWN_TIMEOUT_MS).then(() => {
      process.stderr.write(`Daemon session teardown timed out (${session.name}).\n`);
    }),
  ]);
  sessionStore.writeSessionLog(session);
  sessionStore.delete(session.name);
}

async function openDaemonServers(): Promise<{
  servers: DaemonServer[];
  socketPort?: number;
  httpPort?: number;
}> {
  const servers: DaemonServer[] = [];
  let socketPort: number | undefined;
  let httpPort: number | undefined;
  const startSocketServer = daemonServerMode !== 'http';
  const startHttpServer = daemonServerMode !== 'socket';
  if (startSocketServer) {
    const socketServer = createSocketServer(handleRequest);
    servers.push(socketServer);
    socketPort = await listenNetServer(socketServer);
  }

  if (startHttpServer) {
    const httpServer = await createDaemonHttpServer({ handleRequest, token });
    servers.push(httpServer);
    httpPort = await listenHttpServer(httpServer);
  }
  return { servers, socketPort, httpPort };
}

function publishDaemonInfo(socketPort: number | undefined, httpPort: number | undefined): void {
  writeInfo(baseDir, infoPath, logPath, {
    socketPort,
    httpPort,
    token,
    version,
    codeSignature: daemonCodeSignature,
    processStartTime: daemonProcessStartTime,
  });
  if (socketPort) process.stdout.write(`AGENT_DEVICE_DAEMON_PORT=${socketPort}\n`);
  if (httpPort) process.stdout.write(`AGENT_DEVICE_DAEMON_HTTP_PORT=${httpPort}\n`);
}

function closeServersBestEffort(servers: DaemonServer[]): void {
  for (const server of servers) {
    try {
      server.close(() => {});
    } catch {}
  }
}

async function start(): Promise<void> {
  const lockData = {
    pid: process.pid,
    version,
    startedAt: Date.now(),
    processStartTime: daemonProcessStartTime,
  };
  if (!acquireDaemonLock(baseDir, lockPath, lockData)) {
    process.stderr.write('Daemon lock is held by another process; exiting.\n');
    process.exit(0);
    return;
  }

  let servers: DaemonServer[] = [];
  try {
    const opened = await openDaemonServers();
    servers = opened.servers;
    publishDaemonInfo(opened.socketPort, opened.httpPort);
  } catch (error) {
    const appErr = asAppError(error);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    closeServersBestEffort(servers);
    removeInfo(infoPath);
    releaseDaemonLock(lockPath);
    process.exit(1);
    return;
  }

  let shuttingDown = false;
  const shutdown = async (options: { exitCode?: number; cause?: unknown } = {}) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (options.cause) {
      await emitFatalDiagnostic(options.cause);
    }
    await closeDaemonServers(servers);
    await teardownDaemonSessions();
    await stopAllIosRunnerSessions();
    removeInfo(infoPath);
    releaseDaemonLock(lockPath);
    process.exit(options.exitCode ?? 0);
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
    void shutdown({ exitCode: 1, cause: err });
  });
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const appErr = err instanceof AppError ? err : asAppError(err);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    void shutdown({ exitCode: 1, cause: err });
  });
}

void start();
