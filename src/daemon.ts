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
import { createSocketServer, listenHttpServer, listenNetServer } from './daemon/transport.ts';

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

  const servers: Array<{ close: (cb: (err?: Error) => void) => void }> = [];
  let socketPort: number | undefined;
  let httpPort: number | undefined;

  try {
    if (daemonServerMode === 'socket' || daemonServerMode === 'dual') {
      const socketServer = createSocketServer(handleRequest);
      servers.push(socketServer);
      socketPort = await listenNetServer(socketServer);
    }

    if (daemonServerMode === 'http' || daemonServerMode === 'dual') {
      const httpServer = await createDaemonHttpServer({ handleRequest, token });
      servers.push(httpServer);
      httpPort = await listenHttpServer(httpServer);
    }

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
  } catch (error) {
    const appErr = asAppError(error);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    for (const server of servers) {
      try {
        server.close(() => {});
      } catch {}
    }
    removeInfo(infoPath);
    releaseDaemonLock(lockPath);
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
    removeInfo(infoPath);
    releaseDaemonLock(lockPath);
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
  process.on('unhandledRejection', (reason) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const appErr = err instanceof AppError ? err : asAppError(err);
    process.stderr.write(`Daemon error: ${appErr.message}\n`);
    void shutdown();
  });
}

void start();
