import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { sleep } from './utils/timeouts.ts';
import { AppError, toAppErrorCode } from './utils/errors.ts';
import { consumeTextLines } from './utils/line-stream.ts';
import { readNodeHttpResponseBody } from './utils/node-http.ts';
import type {
  DaemonArtifact,
  DaemonRequest as SharedDaemonRequest,
  DaemonResponse as SharedDaemonResponse,
} from './daemon/types.ts';
import { runCmdDetached, runCmdSync } from './utils/exec.ts';
import { findProjectRoot, readVersion } from './utils/version.ts';
import { createRequestId, emitDiagnostic, withDiagnosticTimer } from './utils/diagnostics.ts';
import { isAgentDeviceDaemonProcess, stopProcessForTakeover } from './utils/process-identity.ts';
import {
  resolveDaemonPaths,
  resolveDaemonServerMode,
  resolveDaemonTransportPreference,
  type DaemonPaths,
  type DaemonServerMode,
  type DaemonTransportPreference,
} from './daemon/config.ts';
import { uploadArtifact } from './upload-client.ts';
import { computeDaemonCodeSignature } from './daemon/code-signature.ts';
import { PUBLIC_COMMANDS } from './command-catalog.ts';
import {
  readDaemonHttpProgressResponse,
  shouldReadDaemonProgressStream,
  writeRequestProgressEvent,
} from './daemon-client-progress.ts';
import {
  isDaemonProgressEnvelope,
  isDaemonResponseEnvelope,
} from './daemon/request-progress-protocol.ts';
export { computeDaemonCodeSignature } from './daemon/code-signature.ts';
export type DaemonRequest = SharedDaemonRequest;
export type DaemonResponse = SharedDaemonResponse;

export type OpenAppOptions = {
  session?: string;
  app?: string;
  url?: string;
  lockPolicy?: NonNullable<DaemonRequest['meta']>['lockPolicy'];
  lockPlatform?: NonNullable<DaemonRequest['meta']>['lockPlatform'];
  platform?: NonNullable<DaemonRequest['flags']>['platform'];
  target?: NonNullable<DaemonRequest['flags']>['target'];
  device?: NonNullable<DaemonRequest['flags']>['device'];
  udid?: NonNullable<DaemonRequest['flags']>['udid'];
  serial?: NonNullable<DaemonRequest['flags']>['serial'];
  activity?: NonNullable<DaemonRequest['flags']>['activity'];
  launchConsole?: NonNullable<DaemonRequest['flags']>['launchConsole'];
  launchArgs?: NonNullable<DaemonRequest['flags']>['launchArgs'];
  out?: NonNullable<DaemonRequest['flags']>['out'];
  saveScript?: NonNullable<DaemonRequest['flags']>['saveScript'];
  relaunch?: boolean;
  runtime?: DaemonRequest['runtime'];
  meta?: Omit<NonNullable<DaemonRequest['meta']>, 'uploadedArtifactId' | 'clientArtifactPaths'>;
};

type DaemonInfo = {
  port?: number;
  httpPort?: number;
  transport?: 'socket' | 'http' | 'dual';
  token: string;
  pid: number;
  version?: string;
  codeSignature?: string;
  processStartTime?: string;
  baseUrl?: string;
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

type DaemonStartupCleanupReason = 'start_error' | 'startup_timeout';

type DaemonStartupCleanupResult = {
  reason: DaemonStartupCleanupReason;
  removedInfo: boolean;
  removedLock: boolean;
  stoppedInfoProcess: boolean;
  stoppedLockProcess: boolean;
  retainedInfoProcess?: boolean;
  retainedLockProcess?: boolean;
  error?: string;
};

type DaemonClientSettings = {
  paths: DaemonPaths;
  transportPreference: DaemonTransportPreference;
  serverMode: DaemonServerMode;
  ownedStateDir?: boolean;
  remoteBaseUrl?: string;
  remoteAuthToken?: string;
};

type EnsuredDaemon = {
  info: DaemonInfo;
  startedByClient: boolean;
};

type ResolvedDaemonTransport = 'socket' | 'http';

const REQUEST_TIMEOUT_MS = 90_000;
const SNAPSHOT_REQUEST_TIMEOUT_MS = 30_000;
const PREPARE_REQUEST_TIMEOUT_MS = 240_000;
const DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DAEMON_STARTUP_ATTEMPTS = 2;
const DAEMON_TAKEOVER_TERM_TIMEOUT_MS = 3000;
const DAEMON_TAKEOVER_KILL_TIMEOUT_MS = 1000;
const LOCAL_DAEMON_HEALTHCHECK_TIMEOUT_MS = 500;
const REMOTE_DAEMON_HEALTHCHECK_TIMEOUT_MS = 3000;
const IOS_RUNNER_XCODEBUILD_KILL_PATTERNS = [
  'xcodebuild .*AgentDeviceRunnerUITests/RunnerTests/testCommand',
  'xcodebuild .*AgentDeviceRunner\\.env\\.session-',
  'xcodebuild build-for-testing .*ios-runner/AgentDeviceRunner/AgentDeviceRunner\\.xcodeproj',
];
const LOOPBACK_BLOCK_LIST = new net.BlockList();
LOOPBACK_BLOCK_LIST.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK_BLOCK_LIST.addAddress('::1', 'ipv6');
LOOPBACK_BLOCK_LIST.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

export async function sendToDaemon(req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> {
  const requestId = req.meta?.requestId ?? createRequestId();
  const debug = Boolean(req.meta?.debug || req.flags?.verbose);
  const settings = resolveClientSettings(req);
  const requestTimeoutMs = resolveDaemonRequestTimeoutMs(req);
  const daemon = await withDiagnosticTimer(
    'daemon_startup',
    async () => await ensureDaemon(settings),
    { requestId, session: req.session },
  );
  const info = daemon.info;
  const preparedRemoteRequest = await prepareRemoteRequest(req, info);

  const request = {
    ...req,
    positionals: preparedRemoteRequest.positionals,
    flags: preparedRemoteRequest.flags,
    token: info.token,
    meta: {
      ...(req.meta ?? {}),
      requestId,
      debug,
      cwd: req.meta?.cwd,
      tenantId: req.meta?.tenantId ?? req.flags?.tenant,
      runId: req.meta?.runId ?? req.flags?.runId,
      leaseId: req.meta?.leaseId ?? req.flags?.leaseId,
      sessionIsolation: req.meta?.sessionIsolation ?? req.flags?.sessionIsolation,
      lockPolicy: req.meta?.lockPolicy,
      lockPlatform: req.meta?.lockPlatform,
      ...(preparedRemoteRequest.uploadedArtifactId
        ? { uploadedArtifactId: preparedRemoteRequest.uploadedArtifactId }
        : {}),
      ...(preparedRemoteRequest.clientArtifactPaths
        ? { clientArtifactPaths: preparedRemoteRequest.clientArtifactPaths }
        : {}),
      ...(preparedRemoteRequest.installSource
        ? { installSource: preparedRemoteRequest.installSource }
        : {}),
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
  try {
    return await withDiagnosticTimer(
      'daemon_request',
      async () => await sendRequest(info, request, settings.transportPreference, requestTimeoutMs),
      { requestId, command: req.command },
    );
  } finally {
    await cleanupDaemonAfterRequest(req, daemon, settings);
  }
}

export function resolveDaemonRequestTimeoutMs(
  req: Omit<DaemonRequest, 'token'>,
): number | undefined {
  if (req.command === PUBLIC_COMMANDS.test) return undefined;
  if (typeof req.flags?.timeoutMs === 'number' && isExplicitTimeoutCommand(req.command)) {
    return req.flags.timeoutMs;
  }
  if (req.command === PUBLIC_COMMANDS.prepare) return PREPARE_REQUEST_TIMEOUT_MS;
  if (req.command === PUBLIC_COMMANDS.snapshot) return SNAPSHOT_REQUEST_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}

function isExplicitTimeoutCommand(command: string | undefined): boolean {
  return (
    command === PUBLIC_COMMANDS.prepare ||
    command === PUBLIC_COMMANDS.replay ||
    command === PUBLIC_COMMANDS.snapshot
  );
}

export async function openApp(options: OpenAppOptions = {}): Promise<DaemonResponse> {
  const {
    session = 'default',
    app,
    url,
    lockPolicy,
    lockPlatform,
    platform,
    target,
    device,
    udid,
    serial,
    activity,
    launchConsole,
    launchArgs,
    out,
    saveScript,
    relaunch,
    runtime,
    meta,
  } = options;

  const positionals = app ? (url ? [app, url] : [app]) : url ? [url] : [];

  return await sendToDaemon({
    session,
    command: 'open',
    positionals,
    flags: {
      ...(platform !== undefined ? { platform } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(device !== undefined ? { device } : {}),
      ...(udid !== undefined ? { udid } : {}),
      ...(serial !== undefined ? { serial } : {}),
      ...(activity !== undefined ? { activity } : {}),
      ...(launchConsole !== undefined ? { launchConsole } : {}),
      ...(launchArgs !== undefined ? { launchArgs } : {}),
      ...(out !== undefined ? { out } : {}),
      ...(saveScript !== undefined ? { saveScript } : {}),
      ...(relaunch ? { relaunch: true } : {}),
    },
    ...(runtime !== undefined ? { runtime } : {}),
    meta: {
      ...(meta ?? {}),
      ...(lockPolicy !== undefined ? { lockPolicy } : {}),
      ...(lockPlatform !== undefined ? { lockPlatform } : {}),
    },
  });
}

async function prepareRemoteRequest(
  req: Omit<DaemonRequest, 'token'>,
  info: DaemonInfo,
): Promise<PreparedRemoteRequest> {
  const positionals = [...(req.positionals ?? [])];
  let flags = req.flags ? { ...req.flags } : undefined;
  let installSource = req.meta?.installSource;
  const clientArtifactPaths: Record<string, string> = {};
  let uploadedArtifactId: string | undefined;

  if (!isRemoteDaemon(info)) {
    return createPreparedRemoteRequest({
      positionals,
      flags,
      installSource,
      uploadedArtifactId,
      clientArtifactPaths,
    });
  }

  flags = applyRemoteArtifactCommand(req, positionals, flags, clientArtifactPaths);
  const remoteInstallSource = await prepareRemoteInstallSource(req, info);
  if (remoteInstallSource) {
    installSource = remoteInstallSource.installSource;
    uploadedArtifactId = remoteInstallSource.uploadedArtifactId ?? uploadedArtifactId;
  }

  const baseResult = (): PreparedRemoteRequest =>
    createPreparedRemoteRequest({
      positionals,
      flags,
      installSource,
      uploadedArtifactId,
      clientArtifactPaths,
    });

  if (req.command !== 'install' && req.command !== 'reinstall') return baseResult();
  const installPackageResult = await prepareRemoteInstallPackage(req, info, positionals);
  uploadedArtifactId = installPackageResult ?? uploadedArtifactId;
  return baseResult();
}

async function prepareRemoteInstallPackage(
  req: Omit<DaemonRequest, 'token'>,
  info: DaemonInfo,
  positionals: string[],
): Promise<string | undefined> {
  const rawPath = positionals[1];
  if (rawPath === undefined) return undefined;
  if (rawPath.startsWith('remote:')) {
    positionals[1] = rawPath.slice('remote:'.length);
    return undefined;
  }

  const localPath = resolveLocalInstallPath(rawPath, req.meta?.cwd);
  if (!localPath) return undefined;

  return await uploadArtifact({
    localPath,
    baseUrl: info.baseUrl!,
    token: info.token,
    platform: req.flags?.platform,
  });
}

function applyRemoteArtifactCommand(
  req: Omit<DaemonRequest, 'token'>,
  positionals: string[],
  flags: DaemonRequest['flags'] | undefined,
  clientArtifactPaths: Record<string, string>,
): DaemonRequest['flags'] | undefined {
  const remoteArtifact = prepareRemoteArtifactCommand(req, positionals);
  if (!remoteArtifact) return flags;
  if (remoteArtifact.positionalPath !== undefined) {
    positionals[remoteArtifact.positionalIndex] = remoteArtifact.positionalPath;
  }
  const nextFlags = applyRemoteArtifactOutFlag(flags, remoteArtifact.flagPath);
  clientArtifactPaths[remoteArtifact.field] = remoteArtifact.localPath;
  return nextFlags;
}

function applyRemoteArtifactOutFlag(
  flags: DaemonRequest['flags'] | undefined,
  flagPath: string | undefined,
): DaemonRequest['flags'] | undefined {
  if (flagPath === undefined) return flags;
  return { ...(flags ?? {}), out: flagPath };
}

function resolveLocalInstallPath(rawPath: string, cwd: string | undefined): string | undefined {
  const localPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(cwd ?? process.cwd(), rawPath);
  return fs.existsSync(localPath) ? localPath : undefined;
}

type PreparedRemoteRequest = {
  positionals: string[];
  flags?: DaemonRequest['flags'];
  installSource?: NonNullable<DaemonRequest['meta']>['installSource'];
  uploadedArtifactId?: string;
  clientArtifactPaths?: Record<string, string>;
};

function createPreparedRemoteRequest(
  result: PreparedRemoteRequest & { clientArtifactPaths: Record<string, string> },
): PreparedRemoteRequest {
  return {
    positionals: result.positionals,
    flags: result.flags,
    installSource: result.installSource,
    uploadedArtifactId: result.uploadedArtifactId,
    ...(Object.keys(result.clientArtifactPaths).length > 0
      ? { clientArtifactPaths: result.clientArtifactPaths }
      : {}),
  };
}

async function prepareRemoteInstallSource(
  req: Omit<DaemonRequest, 'token'>,
  info: DaemonInfo,
): Promise<{
  installSource: NonNullable<DaemonRequest['meta']>['installSource'];
  uploadedArtifactId?: string;
} | null> {
  const source = req.meta?.installSource;
  if (req.command !== 'install_source' || !source || source.kind !== 'path') {
    return null;
  }

  const rawPath = source.path.trim();
  if (!rawPath) {
    return { installSource: source };
  }
  if (rawPath.startsWith('remote:')) {
    return {
      installSource: {
        ...source,
        path: rawPath.slice('remote:'.length),
      },
    };
  }

  const localPath = path.isAbsolute(rawPath)
    ? rawPath
    : path.resolve(req.meta?.cwd ?? process.cwd(), rawPath);
  if (!fs.existsSync(localPath)) {
    return {
      installSource: {
        ...source,
        path: localPath,
      },
    };
  }

  const uploadedArtifactId = await uploadArtifact({
    localPath,
    baseUrl: info.baseUrl!,
    token: info.token,
    platform: req.flags?.platform,
  });
  return {
    installSource: {
      ...source,
      path: localPath,
    },
    uploadedArtifactId,
  };
}

function prepareRemoteArtifactCommand(
  req: Omit<DaemonRequest, 'token'>,
  positionals: string[],
): {
  field: string;
  localPath: string;
  positionalIndex: number;
  positionalPath?: string;
  flagPath?: string;
} | null {
  if (req.command === 'screenshot') {
    const localPath = resolveClientArtifactOutputPath(req, 'path', '.png');
    if (positionals[0]) {
      return {
        field: 'path',
        localPath,
        positionalIndex: 0,
        positionalPath: buildRemoteTempArtifactPath('screenshot', '.png'),
      };
    }
    return {
      field: 'path',
      localPath,
      positionalIndex: 0,
      flagPath: buildRemoteTempArtifactPath('screenshot', '.png'),
    };
  }
  if (req.command === 'record' && (positionals[0] ?? '').toLowerCase() === 'start') {
    const localPath = resolveClientArtifactOutputPath(req, 'outPath', '.mp4', 1);
    return {
      field: 'outPath',
      localPath,
      positionalIndex: 1,
      positionalPath: buildRemoteTempArtifactPath('recording', path.extname(localPath) || '.mp4'),
    };
  }
  return null;
}

function resolveClientArtifactOutputPath(
  req: Omit<DaemonRequest, 'token'>,
  field: 'path' | 'outPath',
  fallbackExtension: string,
  positionalIndex: number = 0,
): string {
  const requested = req.positionals?.[positionalIndex] ?? req.flags?.out;
  const fallbackName = `${field === 'path' ? 'screenshot' : 'recording'}-${Date.now()}${fallbackExtension}`;
  const rawPath = requested && requested.trim().length > 0 ? requested : fallbackName;
  return path.isAbsolute(rawPath) ? rawPath : path.resolve(req.meta?.cwd ?? process.cwd(), rawPath);
}

function buildRemoteTempArtifactPath(prefix: string, extension: string): string {
  const safeExtension = extension.startsWith('.') ? extension : `.${extension}`;
  return path.posix.join(
    '/tmp',
    `agent-device-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${safeExtension}`,
  );
}

function resolveClientSettings(req: Omit<DaemonRequest, 'token'>): DaemonClientSettings {
  const explicitStateDir = resolveExplicitStateDir(req);
  const remote = resolveRemoteClientSettings(req);
  const transport = resolveTransportClientSettings(req, remote.remoteBaseUrl);
  const ownedStateDir = shouldUseOwnedReplayStateDir(req, explicitStateDir, remote.rawBaseUrl);
  const stateDir = ownedStateDir ? createOwnedReplayStateDir() : explicitStateDir;
  return {
    paths: resolveDaemonPaths(stateDir),
    transportPreference: transport.preference,
    serverMode: transport.serverMode,
    ownedStateDir,
    remoteBaseUrl: remote.remoteBaseUrl,
    remoteAuthToken: remote.authToken,
  };
}

function resolveExplicitStateDir(req: Omit<DaemonRequest, 'token'>): string | undefined {
  return req.flags?.stateDir ?? process.env.AGENT_DEVICE_STATE_DIR;
}

function resolveRemoteClientSettings(req: Omit<DaemonRequest, 'token'>): {
  rawBaseUrl: string | undefined;
  remoteBaseUrl?: string;
  authToken?: string;
} {
  const rawBaseUrl = req.flags?.daemonBaseUrl ?? process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const remoteBaseUrl = resolveRemoteDaemonBaseUrl(rawBaseUrl);
  const authToken = req.flags?.daemonAuthToken ?? process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  validateRemoteDaemonTrust(remoteBaseUrl, authToken);
  return { rawBaseUrl, remoteBaseUrl, authToken };
}

function resolveTransportClientSettings(
  req: Omit<DaemonRequest, 'token'>,
  remoteBaseUrl: string | undefined,
): { preference: DaemonTransportPreference; serverMode: DaemonServerMode } {
  const rawTransport = req.flags?.daemonTransport ?? process.env.AGENT_DEVICE_DAEMON_TRANSPORT;
  const preference = resolveDaemonTransportPreference(rawTransport);
  if (remoteBaseUrl && preference === 'socket') {
    throw new AppError(
      'INVALID_ARGS',
      'Remote daemon base URL only supports HTTP transport. Remove --daemon-transport socket.',
      { daemonBaseUrl: remoteBaseUrl },
    );
  }
  const rawServerMode =
    req.flags?.daemonServerMode ??
    process.env.AGENT_DEVICE_DAEMON_SERVER_MODE ??
    (rawTransport === 'dual' ? 'dual' : undefined);
  return {
    preference,
    serverMode: resolveDaemonServerMode(rawServerMode),
  };
}

function shouldUseOwnedReplayStateDir(
  req: Omit<DaemonRequest, 'token'>,
  explicitStateDir: string | undefined,
  rawRemoteBaseUrl: string | undefined,
): boolean {
  return isOneShotReplayCommand(req.command) && !explicitStateDir && !rawRemoteBaseUrl;
}

function createOwnedReplayStateDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-daemon-'));
}

async function ensureDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
  if (settings.remoteBaseUrl) {
    return await ensureRemoteDaemon(settings);
  }

  const reusable = await readReusableLocalDaemon(settings);
  if (reusable) return { info: reusable, startedByClient: false };

  cleanupStaleDaemonLockIfSafe(settings.paths);
  return await startLocalDaemon(settings);
}

async function ensureRemoteDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
  const remoteInfo: DaemonInfo = {
    transport: 'http',
    // Remote mode reuses the auth token as the daemon token so the existing JSON-RPC contract still works.
    token: settings.remoteAuthToken ?? '',
    pid: 0,
    baseUrl: settings.remoteBaseUrl,
  };
  if (await canConnect(remoteInfo, 'http')) {
    return { info: remoteInfo, startedByClient: false };
  }
  throw new AppError('COMMAND_FAILED', 'Remote daemon is unavailable', {
    daemonBaseUrl: settings.remoteBaseUrl,
    hint: 'Verify AGENT_DEVICE_DAEMON_BASE_URL points to a reachable daemon with GET /health and POST /rpc.',
  });
}

async function readReusableLocalDaemon(settings: DaemonClientSettings): Promise<DaemonInfo | null> {
  const existing = readDaemonInfo(settings.paths.infoPath);
  if (!existing) return null;

  const existingReachable = await canConnect(existing, settings.transportPreference);
  if (isReusableDaemonInfo(existing, existingReachable)) return existing;

  await stopDaemonProcessForTakeover(existing);
  removeDaemonInfo(settings.paths.infoPath);
  return null;
}

function isReusableDaemonInfo(info: DaemonInfo, reachable: boolean): boolean {
  return (
    info.version === readVersion() &&
    info.codeSignature === resolveLocalDaemonCodeSignature() &&
    reachable
  );
}

async function startLocalDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
  let lockRecoveryCount = 0;
  const cleanupResults: DaemonStartupCleanupResult[] = [];
  let startError: string | undefined;
  for (let attempt = 1; attempt <= DAEMON_STARTUP_ATTEMPTS; attempt += 1) {
    try {
      await startDaemon(settings);
    } catch (error) {
      startError = error instanceof Error ? error.message : String(error);
      cleanupResults.push(await cleanupFailedDaemonStartupMetadata(settings.paths, 'start_error'));
      if (attempt < DAEMON_STARTUP_ATTEMPTS) {
        await sleep(150);
        continue;
      }
      break;
    }

    const started = await waitForDaemonInfo(DAEMON_STARTUP_TIMEOUT_MS, settings);
    if (started) return { info: started, startedByClient: true };

    if (await recoverDaemonLockHolder(settings.paths)) {
      lockRecoveryCount += 1;
      continue;
    }

    const metadataState = getDaemonMetadataState(settings.paths);
    const hasAnotherAttempt = attempt < DAEMON_STARTUP_ATTEMPTS;
    const cleanup = await cleanupFailedDaemonStartupMetadata(settings.paths, 'startup_timeout', {
      stopLiveProcesses: false,
    });
    cleanupResults.push(cleanup);
    if (cleanup.retainedInfoProcess || cleanup.retainedLockProcess) {
      const extended = await waitForDaemonInfo(DAEMON_STARTUP_TIMEOUT_MS, settings);
      if (extended) return { info: extended, startedByClient: true };
      break;
    }
    if (!hasAnotherAttempt) break;

    // Detached daemon startup can race on busy CI hosts; retry when no metadata exists yet.
    if (!metadataState.hasInfo && !metadataState.hasLock) await sleep(150);
  }

  const state = getDaemonMetadataState(settings.paths);
  throw new AppError('COMMAND_FAILED', 'Failed to start daemon', {
    kind: 'daemon_startup_failed',
    infoPath: settings.paths.infoPath,
    lockPath: settings.paths.lockPath,
    startupTimeoutMs: DAEMON_STARTUP_TIMEOUT_MS,
    startupAttempts: DAEMON_STARTUP_ATTEMPTS,
    lockRecoveryCount,
    cleanupResults,
    startError,
    metadataState: state,
    hint: resolveDaemonStartupHint(state, settings.paths),
  });
}

async function cleanupDaemonAfterRequest(
  req: Omit<DaemonRequest, 'token'>,
  daemon: EnsuredDaemon,
  settings: DaemonClientSettings,
): Promise<void> {
  if (
    !isOneShotReplayCommand(req.command) ||
    (!daemon.startedByClient && !settings.ownedStateDir) ||
    isRemoteDaemon(daemon.info)
  ) {
    return;
  }

  const result = {
    pid: daemon.info.pid,
    removedInfo: false,
    removedLock: false,
    removedStateDir: false,
    error: undefined as string | undefined,
  };

  try {
    await stopDaemonProcessForTakeover(daemon.info);
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    const infoExists = fs.existsSync(settings.paths.infoPath);
    removeDaemonInfo(settings.paths.infoPath);
    result.removedInfo = infoExists && !fs.existsSync(settings.paths.infoPath);

    const lockExists = fs.existsSync(settings.paths.lockPath);
    removeDaemonLock(settings.paths.lockPath);
    result.removedLock = lockExists && !fs.existsSync(settings.paths.lockPath);

    if (settings.ownedStateDir) {
      fs.rmSync(settings.paths.baseDir, { recursive: true, force: true });
      result.removedStateDir = !fs.existsSync(settings.paths.baseDir);
    }
  }

  emitDiagnostic({
    level: result.error ? 'warn' : 'info',
    phase: 'daemon_replay_cleanup',
    data: result,
  });
}

function isOneShotReplayCommand(command: string | undefined): boolean {
  return command === PUBLIC_COMMANDS.replay || command === PUBLIC_COMMANDS.test;
}

async function waitForDaemonInfo(
  timeoutMs: number,
  settings: DaemonClientSettings,
): Promise<DaemonInfo | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = readDaemonInfo(settings.paths.infoPath);
    if (info && (await canConnect(info, settings.transportPreference))) return info;
    await sleep(100);
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
  return false;
}

async function stopDaemonProcessForTakeover(info: DaemonInfo): Promise<void> {
  await stopProcessForTakeover(info.pid, {
    termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
    killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
    expectedStartTime: info.processStartTime,
  });
}

function readDaemonInfo(infoPath: string): DaemonInfo | null {
  const data = readJsonFile(infoPath);
  if (!data || typeof data !== 'object') return null;
  const parsed = data as Partial<DaemonInfo>;
  const token = readRequiredDaemonToken(parsed);
  if (!token) return null;
  const ports = readDaemonInfoPorts(parsed);
  if (!ports) return null;
  return {
    token,
    ...ports,
    transport: readDaemonInfoTransport(parsed.transport),
    pid: readPositiveInteger(parsed.pid) ?? 0,
    version: readOptionalString(parsed.version),
    codeSignature: readOptionalString(parsed.codeSignature),
    processStartTime: readOptionalString(parsed.processStartTime),
  };
}

function readRequiredDaemonToken(parsed: Partial<DaemonInfo>): string | null {
  return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : null;
}

function readDaemonInfoPorts(
  parsed: Partial<DaemonInfo>,
): Pick<DaemonInfo, 'port' | 'httpPort'> | null {
  const port = readPositiveInteger(parsed.port);
  const httpPort = readPositiveInteger(parsed.httpPort);
  if (port === undefined && httpPort === undefined) return null;
  return { port, httpPort };
}

function readDaemonInfoTransport(value: unknown): DaemonInfo['transport'] {
  return value === 'socket' || value === 'http' || value === 'dual' ? value : undefined;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function readDaemonLockInfo(lockPath: string): DaemonLockInfo | null {
  const data = readJsonFile(lockPath);
  if (!data || typeof data !== 'object') return null;
  const parsed = data as Partial<DaemonLockInfo>;
  const hasPid = Number.isInteger(parsed.pid) && Number(parsed.pid) > 0;
  if (!hasPid) {
    return null;
  }
  return {
    pid: Number(parsed.pid),
    processStartTime:
      typeof parsed.processStartTime === 'string' ? parsed.processStartTime : undefined,
    startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : undefined,
  };
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

export async function cleanupFailedDaemonStartupMetadata(
  paths: DaemonPaths,
  reason: DaemonStartupCleanupReason,
  options: { stopLiveProcesses?: boolean } = {},
): Promise<DaemonStartupCleanupResult> {
  const stopLiveProcesses = options.stopLiveProcesses ?? true;
  const result: DaemonStartupCleanupResult = {
    reason,
    removedInfo: false,
    removedLock: false,
    stoppedInfoProcess: false,
    stoppedLockProcess: false,
  };

  try {
    const infoExists = fs.existsSync(paths.infoPath);
    const info = readDaemonInfo(paths.infoPath);
    if (info) {
      const liveInfoProcess = isAgentDeviceDaemonProcess(info.pid, info.processStartTime);
      if (liveInfoProcess && !stopLiveProcesses) {
        result.retainedInfoProcess = true;
      } else {
        if (liveInfoProcess) {
          await stopDaemonProcessForTakeover(info);
          result.stoppedInfoProcess = true;
        }
        removeDaemonInfo(paths.infoPath);
        result.removedInfo = true;
      }
    } else if (infoExists) {
      removeDaemonInfo(paths.infoPath);
      result.removedInfo = true;
    }

    const lockExists = fs.existsSync(paths.lockPath);
    const lockInfo = readDaemonLockInfo(paths.lockPath);
    if (lockInfo) {
      const liveLockProcess = isAgentDeviceDaemonProcess(lockInfo.pid, lockInfo.processStartTime);
      if (liveLockProcess && !stopLiveProcesses) {
        result.retainedLockProcess = true;
      } else {
        if (liveLockProcess) {
          await stopProcessForTakeover(lockInfo.pid, {
            termTimeoutMs: DAEMON_TAKEOVER_TERM_TIMEOUT_MS,
            killTimeoutMs: DAEMON_TAKEOVER_KILL_TIMEOUT_MS,
            expectedStartTime: lockInfo.processStartTime,
          });
          result.stoppedLockProcess = true;
        }
        removeDaemonLock(paths.lockPath);
        result.removedLock = true;
      }
    } else if (lockExists) {
      removeDaemonLock(paths.lockPath);
      result.removedLock = true;
    }
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  emitDiagnostic({
    level: result.error ? 'warn' : 'info',
    phase: 'daemon_startup_metadata_cleanup',
    data: result,
  });
  return result;
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

async function canConnect(
  info: DaemonInfo,
  preference: DaemonTransportPreference,
): Promise<boolean> {
  const transport = chooseTransport(info, preference);
  if (transport === 'http') {
    return await canConnectHttp(info);
  }
  return await canConnectSocket(info.port);
}

export function canConnectSocket(port: number | undefined): Promise<boolean> {
  if (!port) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      finish(true);
    });
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(LOCAL_DAEMON_HEALTHCHECK_TIMEOUT_MS);
    socket.on('timeout', () => {
      finish(false);
    });
    socket.on('error', () => {
      finish(false);
    });
  });
}

function canConnectHttp(info: DaemonInfo): Promise<boolean> {
  const endpoint = info.baseUrl
    ? buildDaemonHttpUrl(info.baseUrl, 'health')
    : info.httpPort
      ? `http://127.0.0.1:${info.httpPort}/health`
      : null;
  if (!endpoint) return Promise.resolve(false);
  const url = new URL(endpoint);
  const transport = url.protocol === 'https:' ? https : http;
  const timeoutMs = info.baseUrl
    ? REMOTE_DAEMON_HEALTHCHECK_TIMEOUT_MS
    : LOCAL_DAEMON_HEALTHCHECK_TIMEOUT_MS;
  return new Promise((resolve) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        host: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: 'GET',
        timeout: timeoutMs,
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
  distPaths: string[];
  srcPath: string;
  useSrc: boolean;
};

function resolveDaemonLaunchSpec(): DaemonLaunchSpec {
  const root = findProjectRoot();
  const distPaths = [
    path.join(root, 'dist', 'src', 'internal', 'daemon.js'),
    path.join(root, 'dist', 'src', 'daemon.js'),
  ];
  const defaultDistPath = distPaths[0];
  if (defaultDistPath === undefined) {
    throw new AppError('COMMAND_FAILED', 'Daemon dist path list is empty');
  }
  const distPath = distPaths.find((candidate) => fs.existsSync(candidate)) ?? defaultDistPath;
  const srcPath = path.join(root, 'src', 'daemon.ts');

  const hasDist = distPaths.some((candidate) => fs.existsSync(candidate));
  const hasSrc = fs.existsSync(srcPath);
  if (!hasDist && !hasSrc) {
    throw new AppError('COMMAND_FAILED', 'Daemon entry not found', { distPaths, srcPath });
  }
  const runningFromSource = process.execArgv.includes('--experimental-strip-types');
  const useSrc = runningFromSource ? hasSrc : !hasDist && hasSrc;
  return { root, distPath, distPaths, srcPath, useSrc };
}

function resolveLocalDaemonCodeSignature(): string {
  const launchSpec = resolveDaemonLaunchSpec();
  const entryPath = launchSpec.useSrc ? launchSpec.srcPath : launchSpec.distPath;
  return computeDaemonCodeSignature(entryPath, launchSpec.root);
}

async function sendRequest(
  info: DaemonInfo,
  req: DaemonRequest,
  preference: DaemonTransportPreference,
  timeoutMs: number | undefined,
): Promise<DaemonResponse> {
  const transport = chooseTransport(info, preference);
  if (transport === 'http') {
    return await sendHttpRequest(info, req, timeoutMs);
  }
  return await sendSocketRequest(info, req, timeoutMs);
}

function chooseTransport(
  info: DaemonInfo,
  preference: DaemonTransportPreference,
): ResolvedDaemonTransport {
  if (info.baseUrl) {
    // Defensive guard: resolveClientSettings rejects this earlier for normal CLI flow.
    if (preference === 'socket') {
      throw new AppError('COMMAND_FAILED', 'Remote daemon endpoint only supports HTTP transport', {
        daemonBaseUrl: info.baseUrl,
      });
    }
    return 'http';
  }
  if (preference === 'http' || preference === 'socket') {
    return requireDaemonTransport(info, preference);
  }
  const autoOrder: ResolvedDaemonTransport[] =
    info.transport === 'socket' || info.transport === 'dual'
      ? ['socket', 'http']
      : ['http', 'socket'];
  const available = autoOrder.find((transport) => hasDaemonTransport(info, transport));
  if (available) return available;
  throw new AppError('COMMAND_FAILED', 'Daemon metadata has no reachable transport');
}

function hasDaemonTransport(info: DaemonInfo, transport: ResolvedDaemonTransport): boolean {
  return transport === 'http' ? Boolean(info.httpPort) : Boolean(info.port);
}

function requireDaemonTransport(
  info: DaemonInfo,
  transport: ResolvedDaemonTransport,
): ResolvedDaemonTransport {
  if (hasDaemonTransport(info, transport)) return transport;
  throw new AppError(
    'COMMAND_FAILED',
    transport === 'http'
      ? 'Daemon HTTP endpoint is unavailable'
      : 'Daemon socket endpoint is unavailable',
  );
}

function handleRequestTimeout(
  info: DaemonInfo,
  statePaths: DaemonPaths,
  requestId: string | undefined,
  command: string | undefined,
  remote: boolean,
  timeoutMs: number,
): AppError {
  const cleanup = remote ? { terminated: 0 } : cleanupTimedOutIosRunnerBuilds();
  const resetDaemon = !remote && shouldResetDaemonAfterRequestTimeout(command);
  const daemonReset = resetDaemon
    ? resetDaemonAfterTimeout(info, statePaths)
    : { forcedKill: false };
  emitDiagnostic({
    level: 'error',
    phase: 'daemon_request_timeout',
    data: {
      timeoutMs,
      requestId,
      command,
      timedOutRunnerPidsTerminated: cleanup.terminated,
      timedOutRunnerCleanupError: cleanup.error,
      daemonPidReset: resetDaemon ? info.pid : undefined,
      daemonPidForceKilled: resetDaemon ? daemonReset.forcedKill : undefined,
      daemonPreservedAfterTimeout: !remote && !resetDaemon,
      daemonBaseUrl: info.baseUrl,
    },
  });
  return new AppError('COMMAND_FAILED', 'Daemon request timed out', {
    timeoutMs,
    requestId,
    hint: resolveRequestTimeoutHint({ remote, resetDaemon, command }),
  });
}

export function shouldResetDaemonAfterRequestTimeout(command: string | undefined): boolean {
  // Snapshot can block in platform accessibility bridges while the app is crashed or never idle.
  // Keep the daemon/session alive so callers can still collect screenshot/perf/log evidence
  // and close the session after the runner abort path has been triggered.
  return command !== 'snapshot';
}

function resolveRequestTimeoutHint(params: {
  remote: boolean;
  resetDaemon: boolean;
  command: string | undefined;
}): string {
  const { remote, resetDaemon, command } = params;
  if (remote) {
    return 'Retry with --debug and verify the remote daemon URL, auth token, and remote host logs.';
  }
  if (!resetDaemon) {
    const iosPrepareHint =
      command === PUBLIC_COMMANDS.snapshot
        ? ' If this was the first iOS snapshot on the device, run agent-device prepare ios-runner --platform ios before snapshot/test so runner startup is handled explicitly.'
        : '';
    return `Retry with --debug and check daemon diagnostics logs. The timed-out ${command ?? 'request'} request was canceled and iOS runner work was aborted when detected; the daemon was kept alive so the session can still be closed or inspected.${iosPrepareHint}`;
  }
  return 'Retry with --debug and check daemon diagnostics logs. Timed-out iOS runner xcodebuild processes were terminated when detected.';
}

function handleTransportError(
  err: unknown,
  requestId: string | undefined,
  remote: boolean,
): AppError {
  emitDiagnostic({
    level: 'error',
    phase: 'daemon_request_socket_error',
    data: {
      requestId,
      message: err instanceof Error ? (err as Error).message : String(err),
    },
  });
  return new AppError(
    'COMMAND_FAILED',
    'Failed to communicate with daemon',
    {
      requestId,
      hint: remote
        ? 'Retry command. If this persists, verify the remote daemon URL, auth token, and remote host reachability.'
        : 'Retry command. If this persists, clean stale daemon metadata and start a fresh session.',
    },
    err instanceof Error ? err : undefined,
  );
}

async function sendSocketRequest(
  info: DaemonInfo,
  req: DaemonRequest,
  timeoutMs: number | undefined,
): Promise<DaemonResponse> {
  const port = info.port;
  if (!port) throw new AppError('COMMAND_FAILED', 'Daemon socket endpoint is unavailable');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.write(`${JSON.stringify(req)}\n`);
    });
    const statePaths = resolveDaemonPaths(
      req.flags?.stateDir ?? process.env.AGENT_DEVICE_STATE_DIR,
    );
    let settled = false;
    const timeoutHandle =
      typeof timeoutMs === 'number'
        ? setTimeout(() => {
            settled = true;
            socket.destroy();
            reject(
              handleRequestTimeout(
                info,
                statePaths,
                req.meta?.requestId,
                req.command,
                false,
                timeoutMs,
              ),
            );
          }, timeoutMs)
        : undefined;

    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      if (settled) return;
      const parsed = consumeTextLines(buffer, chunk);
      buffer = parsed.buffer;
      for (const line of parsed.lines) {
        try {
          const message = JSON.parse(line) as unknown;
          if (isDaemonProgressEnvelope(message)) {
            writeRequestProgressEvent(message.event);
            continue;
          }
          const response = isDaemonResponseEnvelope(message) ? message.response : message;
          settled = true;
          socket.end();
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(response as DaemonResponse);
          return;
        } catch (err) {
          settled = true;
          if (timeoutHandle) clearTimeout(timeoutHandle);
          reject(
            new AppError(
              'COMMAND_FAILED',
              'Invalid daemon response',
              {
                requestId: req.meta?.requestId,
                line,
              },
              err instanceof Error ? err : undefined,
            ),
          );
          return;
        }
      }
    });

    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(handleTransportError(err, req.meta?.requestId, false));
    });
  });
}

async function sendHttpRequest(
  info: DaemonInfo,
  req: DaemonRequest,
  timeoutMs: number | undefined,
): Promise<DaemonResponse> {
  const rpcUrl = info.baseUrl
    ? new URL(buildDaemonHttpUrl(info.baseUrl, 'rpc'))
    : info.httpPort
      ? new URL(`http://127.0.0.1:${info.httpPort}/rpc`)
      : null;
  if (!rpcUrl) throw new AppError('COMMAND_FAILED', 'Daemon HTTP endpoint is unavailable');
  const rpcPayload = JSON.stringify(buildHttpRpcPayload(req, { includeTokenParam: !info.baseUrl }));
  const headers: Record<string, string | number> = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(rpcPayload),
  };
  if (info.baseUrl && info.token) {
    headers.authorization = `Bearer ${info.token}`;
    headers['x-agent-device-token'] = info.token;
  }

  return await new Promise((resolve, reject) => {
    const statePaths = resolveDaemonPaths(
      req.flags?.stateDir ?? process.env.AGENT_DEVICE_STATE_DIR,
    );
    const transport = rpcUrl.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        protocol: rpcUrl.protocol,
        host: rpcUrl.hostname,
        port: rpcUrl.port,
        method: 'POST',
        path: rpcUrl.pathname + rpcUrl.search,
        headers,
      },
      (res) => {
        if (shouldReadDaemonProgressStream(req, res.headers?.['content-type'])) {
          readDaemonHttpProgressResponse(res, {
            req,
            reject,
            clearTimeout: () => {
              if (timeoutHandle) clearTimeout(timeoutHandle);
            },
            handleResponseBody: (body) =>
              handleDaemonHttpResponseBody(body, { info, req, resolve, reject }),
          });
          return;
        }
        void readNodeHttpResponseBody(res)
          .then((body) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            handleDaemonHttpResponseBody(body, { info, req, resolve, reject });
          })
          .catch((err: unknown) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(
              new AppError(
                'COMMAND_FAILED',
                'Failed to read daemon response',
                { requestId: req.meta?.requestId },
                err instanceof Error ? err : undefined,
              ),
            );
          });
      },
    );

    const remote = isRemoteDaemon(info);
    const timeoutHandle =
      typeof timeoutMs === 'number'
        ? setTimeout(() => {
            request.destroy();
            reject(
              handleRequestTimeout(
                info,
                statePaths,
                req.meta?.requestId,
                req.command,
                remote,
                timeoutMs,
              ),
            );
          }, timeoutMs)
        : undefined;

    request.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(handleTransportError(err, req.meta?.requestId, remote));
    });

    request.write(rpcPayload);
    request.end();
  });
}

function handleDaemonHttpResponseBody(
  body: string,
  options: {
    info: DaemonInfo;
    req: DaemonRequest;
    resolve: (response: DaemonResponse | PromiseLike<DaemonResponse>) => void;
    reject: (error: unknown) => void;
  },
): void {
  const { info, req, resolve, reject } = options;
  try {
    const parsed = parseDaemonHttpResponseBody(body);
    if (parsed.error) {
      reject(toDaemonHttpRpcError(parsed.error, req.meta?.requestId));
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
    void resolveDaemonHttpResult(info, req, parsed.result, resolve, reject);
  } catch (err) {
    reject(
      new AppError(
        'COMMAND_FAILED',
        'Invalid daemon response',
        {
          requestId: req.meta?.requestId,
          line: body,
        },
        err instanceof Error ? err : undefined,
      ),
    );
  }
}

function parseDaemonHttpResponseBody(body: string): {
  result?: DaemonResponse;
  error?: { message?: string; data?: Record<string, unknown> };
} {
  return JSON.parse(body) as {
    result?: DaemonResponse;
    error?: { message?: string; data?: Record<string, unknown> };
  };
}

function toDaemonHttpRpcError(
  error: { message?: string; data?: Record<string, unknown> },
  requestId: string | undefined,
): AppError {
  const data = error.data ?? {};
  return new AppError(
    toAppErrorCode(data.code != null ? String(data.code) : undefined, 'COMMAND_FAILED'),
    String(data.message ?? error.message ?? 'Daemon RPC request failed'),
    {
      ...(typeof data.details === 'object' && data.details ? data.details : {}),
      hint: typeof data.hint === 'string' ? data.hint : undefined,
      diagnosticId: typeof data.diagnosticId === 'string' ? data.diagnosticId : undefined,
      logPath: typeof data.logPath === 'string' ? data.logPath : undefined,
      requestId,
    },
  );
}

async function resolveDaemonHttpResult(
  info: DaemonInfo,
  req: DaemonRequest,
  result: DaemonResponse,
  resolve: (response: DaemonResponse | PromiseLike<DaemonResponse>) => void,
  reject: (error: unknown) => void,
): Promise<void> {
  try {
    resolve(
      info.baseUrl && result.ok ? await materializeRemoteArtifacts(info, req, result) : result,
    );
  } catch (error) {
    reject(error);
  }
}

function buildHttpRpcPayload(
  req: DaemonRequest,
  options: { includeTokenParam: boolean },
): {
  jsonrpc: '2.0';
  id: string;
  method: string;
  params: DaemonRequest | Record<string, unknown>;
} {
  const id = req.meta?.requestId ?? createRequestId();
  if (!isLeaseRpcCommand(req.command)) {
    return {
      jsonrpc: '2.0',
      id,
      method: 'agent_device.command',
      params: req,
    };
  }
  return {
    jsonrpc: '2.0',
    id,
    method: leaseRpcMethodForCommand(req.command),
    params: buildLeaseRpcParams(req, req.command, options),
  };
}

type LeaseRpcCommand = 'lease_allocate' | 'lease_heartbeat' | 'lease_release';

function isLeaseRpcCommand(command: string): command is LeaseRpcCommand {
  return (
    command === 'lease_allocate' || command === 'lease_heartbeat' || command === 'lease_release'
  );
}

function leaseRpcMethodForCommand(command: LeaseRpcCommand): string {
  switch (command) {
    case 'lease_allocate':
      return 'agent_device.lease.allocate';
    case 'lease_heartbeat':
      return 'agent_device.lease.heartbeat';
    case 'lease_release':
      return 'agent_device.lease.release';
  }
}

function buildLeaseRpcParams(
  req: DaemonRequest,
  command: LeaseRpcCommand,
  options: { includeTokenParam: boolean },
): Record<string, unknown> {
  const common = {
    ...(options.includeTokenParam ? { token: req.token } : {}),
    session: req.session,
    tenantId: req.meta?.tenantId,
    runId: req.meta?.runId,
  };
  switch (command) {
    case 'lease_allocate':
      return {
        ...common,
        ttlMs: req.meta?.leaseTtlMs,
        backend: req.meta?.leaseBackend,
      };
    case 'lease_heartbeat':
      return {
        ...common,
        leaseId: req.meta?.leaseId,
        ttlMs: req.meta?.leaseTtlMs,
      };
    case 'lease_release':
      return {
        ...common,
        leaseId: req.meta?.leaseId,
      };
  }
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

function isRemoteDaemon(info: DaemonInfo): boolean {
  return typeof info.baseUrl === 'string' && info.baseUrl.length > 0;
}

function resolveRemoteDaemonBaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new AppError(
      'INVALID_ARGS',
      'Invalid daemon base URL',
      {
        daemonBaseUrl: raw,
      },
      error instanceof Error ? error : undefined,
    );
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('INVALID_ARGS', 'Daemon base URL must use http or https', {
      daemonBaseUrl: raw,
    });
  }
  return parsed.toString().replace(/\/+$/, '');
}

function validateRemoteDaemonTrust(
  remoteBaseUrl: string | undefined,
  remoteAuthToken: string | undefined,
): void {
  if (!remoteBaseUrl) return;
  const hostname = new URL(remoteBaseUrl).hostname;
  if (isLoopbackHostname(hostname)) return;
  if (typeof remoteAuthToken === 'string' && remoteAuthToken.trim().length > 0) return;
  throw new AppError(
    'INVALID_ARGS',
    'Remote daemon base URL for non-loopback hosts requires daemon authentication',
    {
      daemonBaseUrl: remoteBaseUrl,
      hint: 'Provide --daemon-auth-token or AGENT_DEVICE_DAEMON_AUTH_TOKEN when using a non-loopback remote daemon URL.',
    },
  );
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[(.*)\]$/, '$1');
  if (normalized === 'localhost') return true;
  if (net.isIPv4(normalized)) return LOOPBACK_BLOCK_LIST.check(normalized, 'ipv4');
  if (net.isIPv6(normalized)) return LOOPBACK_BLOCK_LIST.check(normalized, 'ipv6');
  return false;
}

function buildDaemonHttpUrl(baseUrl: string, route: 'health' | 'rpc'): string {
  // URL(base, relative) treats a base without trailing slash as a file path, so normalize to a directory-like base.
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(route, normalizedBase).toString();
}

function buildDaemonArtifactUrl(baseUrl: string, artifactId: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(`artifacts/${encodeURIComponent(artifactId)}`, normalizedBase).toString();
}

async function materializeRemoteArtifacts(
  info: DaemonInfo,
  req: DaemonRequest,
  response: Extract<DaemonResponse, { ok: true }>,
): Promise<DaemonResponse> {
  const artifacts = Array.isArray(response.data?.artifacts) ? response.data.artifacts : [];
  if (artifacts.length === 0 || !info.baseUrl) return response;
  const nextData = response.data ? { ...response.data } : {};
  const nextArtifacts: DaemonArtifact[] = [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object' || typeof artifact.artifactId !== 'string') {
      nextArtifacts.push(artifact);
      continue;
    }
    const localPath = resolveMaterializedArtifactPath(artifact, req);
    await downloadRemoteArtifact({
      baseUrl: info.baseUrl,
      token: info.token,
      artifactId: artifact.artifactId,
      destinationPath: localPath,
      requestId: req.meta?.requestId,
    });
    nextData[artifact.field] = localPath;
    nextArtifacts.push({
      ...artifact,
      localPath,
    });
  }
  nextData.artifacts = nextArtifacts;
  return { ok: true, data: nextData };
}

function resolveMaterializedArtifactPath(artifact: DaemonArtifact, req: DaemonRequest): string {
  if (artifact.localPath && artifact.localPath.trim().length > 0) {
    return artifact.localPath;
  }
  const requestedPath = req.meta?.clientArtifactPaths?.[artifact.field];
  if (requestedPath && requestedPath.trim().length > 0) {
    return requestedPath;
  }
  const fallbackName = artifact.fileName?.trim() || `${artifact.field}-${Date.now()}`;
  return path.resolve(req.meta?.cwd ?? process.cwd(), fallbackName);
}

export async function downloadRemoteArtifact(params: {
  baseUrl: string;
  token: string;
  artifactId: string;
  destinationPath: string;
  requestId?: string;
  timeoutMs?: number;
}): Promise<void> {
  const artifactUrl = new URL(buildDaemonArtifactUrl(params.baseUrl, params.artifactId));
  const transport = artifactUrl.protocol === 'https:' ? https : http;
  await fs.promises.mkdir(path.dirname(params.destinationPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeoutMs = params.timeoutMs ?? REQUEST_TIMEOUT_MS;
    const settle = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (error) {
        void fs.promises.rm(params.destinationPath, { force: true }).finally(() => reject(error));
        return;
      }
      resolve();
    };
    const request = transport.request(
      {
        protocol: artifactUrl.protocol,
        host: artifactUrl.hostname,
        port: artifactUrl.port,
        method: 'GET',
        path: artifactUrl.pathname + artifactUrl.search,
        headers: params.token
          ? {
              authorization: `Bearer ${params.token}`,
              'x-agent-device-token': params.token,
            }
          : undefined,
      },
      (res) => {
        if ((res.statusCode ?? 500) >= 400) {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            settle(
              new AppError('COMMAND_FAILED', 'Failed to download remote artifact', {
                artifactId: params.artifactId,
                statusCode: res.statusCode,
                requestId: params.requestId,
                body,
              }),
            );
          });
          return;
        }
        res.on('aborted', () => {
          settle(
            new AppError('COMMAND_FAILED', 'Remote artifact download was interrupted', {
              artifactId: params.artifactId,
              requestId: params.requestId,
            }),
          );
        });
        void pipeline(res, fs.createWriteStream(params.destinationPath)).then(
          () => settle(),
          (error: unknown) => settle(error instanceof Error ? error : new Error(String(error))),
        );
      },
    );
    const timeoutHandle = setTimeout(() => {
      const timeoutError = new AppError('COMMAND_FAILED', 'Remote artifact download timed out', {
        artifactId: params.artifactId,
        requestId: params.requestId,
        timeoutMs,
      });
      settle(timeoutError);
      request.destroy(timeoutError);
    }, timeoutMs);
    request.on('error', (error) => {
      if (error instanceof AppError) {
        settle(error);
        return;
      }
      settle(
        new AppError(
          'COMMAND_FAILED',
          'Failed to download remote artifact',
          {
            artifactId: params.artifactId,
            requestId: params.requestId,
            timeoutMs,
          },
          error instanceof Error ? error : undefined,
        ),
      );
    });
    request.end();
  });
}

export function resolveDaemonStartupHint(
  state: { hasInfo: boolean; hasLock: boolean },
  paths: Pick<DaemonPaths, 'infoPath' | 'lockPath'> = resolveDaemonPaths(
    process.env.AGENT_DEVICE_STATE_DIR,
  ),
): string {
  if (state.hasLock && !state.hasInfo) {
    return `agent-device attempted to clean stale daemon metadata automatically, but ${paths.lockPath} still exists without ${paths.infoPath}. Retry with --debug; if this persists, remove ${paths.lockPath} after confirming no agent-device daemon process is running.`;
  }
  if (state.hasLock && state.hasInfo) {
    return `agent-device attempted to clean stale daemon metadata automatically, but ${paths.infoPath} and ${paths.lockPath} still remain. Retry with --debug; if this persists, remove both files after confirming no agent-device daemon process is running.`;
  }
  return `agent-device did not observe reachable daemon metadata after retrying. Stale metadata was cleaned automatically when safe; retry with --debug and check daemon diagnostics logs.`;
}
