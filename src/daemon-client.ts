import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from './utils/errors.ts';
import type { DaemonRequest as SharedDaemonRequest, DaemonResponse as SharedDaemonResponse } from './daemon/types.ts';
import { runCmdDetached, runCmdSync } from './utils/exec.ts';
import { findProjectRoot, readVersion } from './utils/version.ts';
import { createRequestId, emitDiagnostic, withDiagnosticTimer } from './utils/diagnostics.ts';
import {
  isAgentDeviceDaemonProcess,
  stopProcessForTakeover,
} from './utils/process-identity.ts';
import {
  resolveDaemonPaths,
  resolveDaemonServerMode,
  resolveDaemonTransportPreference,
  type DaemonPaths,
  type DaemonServerMode,
  type DaemonTransportPreference,
} from './daemon/config.ts';

export type DaemonRequest = SharedDaemonRequest;
export type DaemonResponse = SharedDaemonResponse;

type DaemonInfo = {
  port?: number;
  httpPort?: number;
  transport?: 'socket' | 'http' | 'dual';
  token: string;
  pid: number;
  version?: string;
  codeSignature?: string;
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

type DaemonClientSettings = {
  paths: DaemonPaths;
  transportPreference: DaemonTransportPreference;
  serverMode: DaemonServerMode;
};

const REQUEST_TIMEOUT_MS = resolveDaemonRequestTimeoutMs();
const DAEMON_STARTUP_TIMEOUT_MS = 5000;
const DAEMON_TAKEOVER_TERM_TIMEOUT_MS = 3000;
const DAEMON_TAKEOVER_KILL_TIMEOUT_MS = 1000;
const IOS_RUNNER_XCODEBUILD_KILL_PATTERNS = [
  'xcodebuild .*AgentDeviceRunnerUITests/RunnerTests/testCommand',
  'xcodebuild .*AgentDeviceRunner\\.env\\.session-',
  'xcodebuild build-for-testing .*ios-runner/AgentDeviceRunner/AgentDeviceRunner\\.xcodeproj',
];

export async function sendToDaemon(req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> {
  const requestId = req.meta?.requestId ?? createRequestId();
  const debug = Boolean(req.meta?.debug || req.flags?.verbose);
  const settings = resolveClientSettings(req);
  const info = await withDiagnosticTimer(
    'daemon_startup',
    async () => await ensureDaemon(settings),
    { requestId, session: req.session },
  );
  const request = {
    ...req,
    token: info.token,
    meta: {
      requestId,
      debug,
      cwd: req.meta?.cwd,
      tenantId: req.meta?.tenantId ?? req.flags?.tenant,
      runId: req.meta?.runId ?? req.flags?.runId,
      leaseId: req.meta?.leaseId ?? req.flags?.leaseId,
      sessionIsolation: req.meta?.sessionIsolation ?? req.flags?.sessionIsolation,
    },
  };
  emitDiagnostic({
    level: 'info',
    phase: 'daemon_request_prepare',
    data: {
      requestId,
      command: req.command,
      session: req.session,
    },
  });
  return await withDiagnosticTimer(
    'daemon_request',
    async () => await sendRequest(info, request, settings.transportPreference),
    { requestId, command: req.command },
  );
}

function resolveClientSettings(req: Omit<DaemonRequest, 'token'>): DaemonClientSettings {
  const stateDir = req.flags?.stateDir ?? process.env.AGENT_DEVICE_STATE_DIR;
  const rawTransport = req.flags?.daemonTransport ?? process.env.AGENT_DEVICE_DAEMON_TRANSPORT;
  const transportPreference = resolveDaemonTransportPreference(rawTransport);
  const rawServerMode =
    req.flags?.daemonServerMode
    ?? process.env.AGENT_DEVICE_DAEMON_SERVER_MODE
    ?? (rawTransport === 'dual' ? 'dual' : undefined);
  const serverMode = resolveDaemonServerMode(rawServerMode);
  return {
    paths: resolveDaemonPaths(stateDir),
    transportPreference,
    serverMode,
  };
}

async function ensureDaemon(settings: DaemonClientSettings): Promise<DaemonInfo> {
  const existing = readDaemonInfo(settings.paths.infoPath);
  const localVersion = readVersion();
  const localCodeSignature = resolveLocalDaemonCodeSignature();
  const existingReachable = existing ? await canConnect(existing, settings.transportPreference) : false;
  if (
    existing
    && existing.version === localVersion
    && existing.codeSignature === localCodeSignature
    && existingReachable
  ) {
    return existing;
  }
  if (
    existing
    && (
      existing.version !== localVersion
      || existing.codeSignature !== localCodeSignature
      || !existingReachable
    )
  ) {
    await stopDaemonProcessForTakeover(existing);
    removeDaemonInfo(settings.paths.infoPath);
  }

  cleanupStaleDaemonLockIfSafe(settings.paths);
  await startDaemon(settings);
  const started = await waitForDaemonInfo(DAEMON_STARTUP_TIMEOUT_MS, settings);
  if (started) return started;

  if (await recoverDaemonLockHolder(settings.paths)) {
    await startDaemon(settings);
    const recovered = await waitForDaemonInfo(DAEMON_STARTUP_TIMEOUT_MS, settings);
    if (recovered) return recovered;
  }

  throw new AppError('COMMAND_FAILED', 'Failed to start daemon', {
    kind: 'daemon_startup_failed',
    infoPath: settings.paths.infoPath,
    lockPath: settings.paths.lockPath,
    hint: resolveDaemonStartupHint(getDaemonMetadataState(settings.paths), settings.paths),
  });
}

async function waitForDaemonInfo(timeoutMs: number, settings: DaemonClientSettings): Promise<DaemonInfo | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = readDaemonInfo(settings.paths.infoPath);
    if (info && (await canConnect(info, settings.transportPreference))) return info;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return null;
}

async function recoverDaemonLockHolder(paths: DaemonPaths): Promise<boolean> {
  const state = getDaemonMetadataState(paths);
  if (!state.hasLock || state.hasInfo) return false;
  const lockInfo = readDaemonLockInfo(paths.lockPath);
  if (!lockInfo) {
    removeDaemonLock(paths.lockPath);
    return true;
  }
  if (!isAgentDeviceDaemonProcess(lockInfo.pid, lockInfo.processStartTime)) {
    removeDaemonLock(paths.lockPath);
    return true;
  }
  await stopProcessForTakeover(lockInfo.pid, {
    termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
    killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
    expectedStartTime: lockInfo.processStartTime,
  });
  removeDaemonLock(paths.lockPath);
  return true;
}

async function stopDaemonProcessForTakeover(info: DaemonInfo): Promise<void> {
  await stopProcessForTakeover(info.pid, {
    termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
    killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
    expectedStartTime: info.processStartTime,
  });
}

function readDaemonInfo(infoPath: string): DaemonInfo | null {
  const data = readJsonFile(infoPath) as DaemonInfo | null;
  if (!data || typeof data.token !== 'string' || data.token.length === 0) return null;
  const hasSocket = Number.isInteger(data.port) && Number(data.port) > 0;
  const hasHttp = Number.isInteger(data.httpPort) && Number(data.httpPort) > 0;
  if (!hasSocket && !hasHttp) return null;
  return {
    ...data,
    port: hasSocket ? Number(data.port) : undefined,
    httpPort: hasHttp ? Number(data.httpPort) : undefined,
    pid: Number.isInteger(data.pid) && data.pid > 0 ? data.pid : 0,
  };
}

function readDaemonLockInfo(lockPath: string): DaemonLockInfo | null {
  const data = readJsonFile(lockPath) as DaemonLockInfo | null;
  if (!data || !Number.isInteger(data.pid) || data.pid <= 0) {
    return null;
  }
  return data;
}

function removeDaemonInfo(infoPath: string): void {
  removeFileIfExists(infoPath);
}

function removeDaemonLock(lockPath: string): void {
  removeFileIfExists(lockPath);
}

function cleanupStaleDaemonLockIfSafe(paths: DaemonPaths): void {
  const state = getDaemonMetadataState(paths);
  if (!state.hasLock || state.hasInfo) return;
  const lockInfo = readDaemonLockInfo(paths.lockPath);
  if (!lockInfo) {
    removeDaemonLock(paths.lockPath);
    return;
  }
  if (isAgentDeviceDaemonProcess(lockInfo.pid, lockInfo.processStartTime)) {
    return;
  }
  removeDaemonLock(paths.lockPath);
}

function getDaemonMetadataState(paths: DaemonPaths): DaemonMetadataState {
  return {
    hasInfo: fs.existsSync(paths.infoPath),
    hasLock: fs.existsSync(paths.lockPath),
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

async function canConnect(info: DaemonInfo, preference: DaemonTransportPreference): Promise<boolean> {
  const transport = chooseTransport(info, preference);
  if (transport === 'http') {
    return await canConnectHttp(info.httpPort);
  }
  return await canConnectSocket(info.port);
}

function canConnectSocket(port: number | undefined): Promise<boolean> {
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => {
      resolve(false);
    });
  });
}

function canConnectHttp(httpPort: number | undefined): Promise<boolean> {
  if (!httpPort) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: httpPort,
        path: '/health',
        method: 'GET',
        timeout: 500,
      },
      (res) => {
        res.resume();
        resolve((res.statusCode ?? 500) < 500);
      },
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => {
      resolve(false);
    });
    req.end();
  });
}

async function startDaemon(settings: DaemonClientSettings): Promise<void> {
  const launchSpec = resolveDaemonLaunchSpec();
  const args = launchSpec.useSrc
    ? ['--experimental-strip-types', launchSpec.srcPath]
    : [launchSpec.distPath];
  const env = {
    ...process.env,
    AGENT_DEVICE_STATE_DIR: settings.paths.baseDir,
    AGENT_DEVICE_DAEMON_SERVER_MODE: settings.serverMode,
  };

  runCmdDetached(process.execPath, args, { env });
}

type DaemonLaunchSpec = {
  root: string;
  distPath: string;
  srcPath: string;
  useSrc: boolean;
};

function resolveDaemonLaunchSpec(): DaemonLaunchSpec {
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
  return { root, distPath, srcPath, useSrc };
}

function resolveLocalDaemonCodeSignature(): string {
  const launchSpec = resolveDaemonLaunchSpec();
  const entryPath = launchSpec.useSrc ? launchSpec.srcPath : launchSpec.distPath;
  return computeDaemonCodeSignature(entryPath, launchSpec.root);
}

export function computeDaemonCodeSignature(entryPath: string, root: string = findProjectRoot()): string {
  try {
    const stat = fs.statSync(entryPath);
    const relativePath = path.relative(root, entryPath) || entryPath;
    return `${relativePath}:${stat.size}:${Math.trunc(stat.mtimeMs)}`;
  } catch {
    return 'unknown';
  }
}

async function sendRequest(
  info: DaemonInfo,
  req: DaemonRequest,
  preference: DaemonTransportPreference,
): Promise<DaemonResponse> {
  const transport = chooseTransport(info, preference);
  if (transport === 'http') {
    return await sendHttpRequest(info, req);
  }
  return await sendSocketRequest(info, req);
}

function chooseTransport(info: DaemonInfo, preference: DaemonTransportPreference): 'socket' | 'http' {
  if (preference === 'http') {
    if (!info.httpPort) throw new AppError('COMMAND_FAILED', 'Daemon HTTP endpoint is unavailable');
    return 'http';
  }
  if (preference === 'socket') {
    if (!info.port) throw new AppError('COMMAND_FAILED', 'Daemon socket endpoint is unavailable');
    return 'socket';
  }
  const transport = info.transport;
  if (transport === 'http' && info.httpPort) return 'http';
  if ((transport === 'socket' || transport === 'dual') && info.port) return 'socket';
  if (info.httpPort) return 'http';
  if (info.port) return 'socket';
  throw new AppError('COMMAND_FAILED', 'Daemon metadata has no reachable transport');
}

async function sendSocketRequest(info: DaemonInfo, req: DaemonRequest): Promise<DaemonResponse> {
  const port = info.port;
  if (!port) throw new AppError('COMMAND_FAILED', 'Daemon socket endpoint is unavailable');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`${JSON.stringify(req)}\n`);
    });
    const timeout = setTimeout(() => {
      socket.destroy();
      const cleanup = cleanupTimedOutIosRunnerBuilds();
      const daemonReset = resetDaemonAfterTimeout(info, resolveDaemonPaths(req.flags?.stateDir ?? process.env.AGENT_DEVICE_STATE_DIR));
      emitDiagnostic({
        level: 'error',
        phase: 'daemon_request_timeout',
        data: {
          timeoutMs: REQUEST_TIMEOUT_MS,
          requestId: req.meta?.requestId,
          command: req.command,
          timedOutRunnerPidsTerminated: cleanup.terminated,
          timedOutRunnerCleanupError: cleanup.error,
          daemonPidReset: info.pid,
          daemonPidForceKilled: daemonReset.forcedKill,
        },
      });
      reject(
        new AppError('COMMAND_FAILED', 'Daemon request timed out', {
          timeoutMs: REQUEST_TIMEOUT_MS,
          requestId: req.meta?.requestId,
          hint: 'Retry with --debug and check daemon diagnostics logs. Timed-out iOS runner xcodebuild processes were terminated when detected.',
        }),
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
        reject(new AppError('COMMAND_FAILED', 'Invalid daemon response', {
          requestId: req.meta?.requestId,
          line,
        }, err instanceof Error ? err : undefined));
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timeout);
      emitDiagnostic({
        level: 'error',
        phase: 'daemon_request_socket_error',
        data: {
          requestId: req.meta?.requestId,
          message: err instanceof Error ? err.message : String(err),
        },
      });
      reject(
        new AppError(
          'COMMAND_FAILED',
          'Failed to communicate with daemon',
          {
            requestId: req.meta?.requestId,
            hint: 'Retry command. If this persists, clean stale daemon metadata and start a fresh session.',
          },
          err,
        ),
      );
    });
  });
}

async function sendHttpRequest(info: DaemonInfo, req: DaemonRequest): Promise<DaemonResponse> {
  const httpPort = info.httpPort;
  if (!httpPort) throw new AppError('COMMAND_FAILED', 'Daemon HTTP endpoint is unavailable');
  const rpcPayload = JSON.stringify({
    jsonrpc: '2.0',
    id: req.meta?.requestId ?? createRequestId(),
    method: 'agent_device.command',
    params: req,
  });

  return await new Promise((resolve, reject) => {
    const statePaths = resolveDaemonPaths(req.flags?.stateDir ?? process.env.AGENT_DEVICE_STATE_DIR);
    const request = http.request(
      {
        host: '127.0.0.1',
        port: httpPort,
        method: 'POST',
        path: '/rpc',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(rpcPayload),
        },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          clearTimeout(timeout);
          try {
            const parsed = JSON.parse(body) as {
              result?: DaemonResponse;
              error?: {
                message?: string;
                data?: Record<string, unknown>;
              };
            };
            if (parsed.error) {
              const data = parsed.error.data ?? {};
              reject(
                new AppError(
                  String(data.code ?? 'COMMAND_FAILED') as any,
                  String(data.message ?? parsed.error.message ?? 'Daemon RPC request failed'),
                  {
                    ...(typeof data.details === 'object' && data.details ? data.details : {}),
                    hint: typeof data.hint === 'string' ? data.hint : undefined,
                    diagnosticId: typeof data.diagnosticId === 'string' ? data.diagnosticId : undefined,
                    logPath: typeof data.logPath === 'string' ? data.logPath : undefined,
                    requestId: req.meta?.requestId,
                  },
                ),
              );
              return;
            }
            if (!parsed.result || typeof parsed.result !== 'object') {
              reject(
                new AppError('COMMAND_FAILED', 'Invalid daemon RPC response', {
                  requestId: req.meta?.requestId,
                }),
              );
              return;
            }
            resolve(parsed.result);
          } catch (err) {
            clearTimeout(timeout);
            reject(
              new AppError('COMMAND_FAILED', 'Invalid daemon response', {
                requestId: req.meta?.requestId,
                line: body,
              }, err instanceof Error ? err : undefined),
            );
          }
        });
      },
    );

    const timeout = setTimeout(() => {
      request.destroy();
      const cleanup = cleanupTimedOutIosRunnerBuilds();
      const daemonReset = resetDaemonAfterTimeout(info, statePaths);
      emitDiagnostic({
        level: 'error',
        phase: 'daemon_request_timeout',
        data: {
          timeoutMs: REQUEST_TIMEOUT_MS,
          requestId: req.meta?.requestId,
          command: req.command,
          timedOutRunnerPidsTerminated: cleanup.terminated,
          timedOutRunnerCleanupError: cleanup.error,
          daemonPidReset: info.pid,
          daemonPidForceKilled: daemonReset.forcedKill,
        },
      });
      reject(
        new AppError('COMMAND_FAILED', 'Daemon request timed out', {
          timeoutMs: REQUEST_TIMEOUT_MS,
          requestId: req.meta?.requestId,
          hint: 'Retry with --debug and check daemon diagnostics logs. Timed-out iOS runner xcodebuild processes were terminated when detected.',
        }),
      );
    }, REQUEST_TIMEOUT_MS);

    request.on('error', (err) => {
      clearTimeout(timeout);
      emitDiagnostic({
        level: 'error',
        phase: 'daemon_request_socket_error',
        data: {
          requestId: req.meta?.requestId,
          message: err instanceof Error ? err.message : String(err),
        },
      });
      reject(
        new AppError(
          'COMMAND_FAILED',
          'Failed to communicate with daemon',
          {
            requestId: req.meta?.requestId,
            hint: 'Retry command. If this persists, clean stale daemon metadata and start a fresh session.',
          },
          err,
        ),
      );
    });

    request.write(rpcPayload);
    request.end();
  });
}

function cleanupTimedOutIosRunnerBuilds(): { terminated: number; error?: string } {
  let terminated = 0;
  try {
    for (const pattern of IOS_RUNNER_XCODEBUILD_KILL_PATTERNS) {
      const result = runCmdSync('pkill', ['-f', pattern], { allowFailure: true });
      if (result.exitCode === 0) terminated += 1;
    }
    return { terminated };
  } catch (error) {
    return {
      terminated,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resetDaemonAfterTimeout(info: DaemonInfo, paths: DaemonPaths): { forcedKill: boolean } {
  let forcedKill = false;
  try {
    if (isAgentDeviceDaemonProcess(info.pid, info.processStartTime)) {
      process.kill(info.pid, 'SIGKILL');
      forcedKill = true;
    }
  } catch {
    void stopProcessForTakeover(info.pid, {
      termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
      killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
      expectedStartTime: info.processStartTime,
    });
  } finally {
    removeDaemonInfo(paths.infoPath);
    removeDaemonLock(paths.lockPath);
  }
  return { forcedKill };
}

export function resolveDaemonRequestTimeoutMs(raw: string | undefined = process.env.AGENT_DEVICE_DAEMON_TIMEOUT_MS): number {
  if (!raw) return 90000;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 90000;
  return Math.max(1000, Math.floor(parsed));
}

export function resolveDaemonStartupHint(
  state: { hasInfo: boolean; hasLock: boolean },
  paths: Pick<DaemonPaths, 'infoPath' | 'lockPath'> = resolveDaemonPaths(process.env.AGENT_DEVICE_STATE_DIR),
): string {
  if (state.hasLock && !state.hasInfo) {
    return `Detected ${paths.lockPath} without ${paths.infoPath}. If no agent-device daemon process is running, delete ${paths.lockPath} and retry.`;
  }
  if (state.hasLock && state.hasInfo) {
    return `Daemon metadata may be stale. If no agent-device daemon process is running, delete ${paths.infoPath} and ${paths.lockPath}, then retry.`;
  }
  return `Daemon metadata is missing or stale. Delete ${paths.infoPath} if present and retry.`;
}
