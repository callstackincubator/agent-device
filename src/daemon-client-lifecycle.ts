import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { AppError } from './utils/errors.ts';
import type { DaemonRequest } from './daemon/types.ts';
import { runCmdDetached } from './utils/exec.ts';
import { findProjectRoot, readVersion } from './utils/version.ts';
import { emitDiagnostic } from './utils/diagnostics.ts';
import {
  resolveDaemonPaths,
  resolveDaemonServerMode,
  resolveDaemonTransportPreference,
  type DaemonPaths,
  type DaemonServerMode,
  type DaemonTransportPreference,
} from './daemon/config.ts';
import { computeDaemonCodeSignature } from './daemon/code-signature.ts';
import { PUBLIC_COMMANDS } from './command-catalog.ts';
import { sleep } from './utils/timeouts.ts';
import {
  cleanupFailedDaemonStartupMetadata,
  cleanupStaleDaemonLockIfSafe,
  getDaemonMetadataState,
  isRemoteDaemon,
  readDaemonInfo,
  recoverDaemonLockHolder,
  removeDaemonInfo,
  removeDaemonLock,
  resolveDaemonStartupHint,
  stopDaemonProcessForTakeover,
  type DaemonInfo,
  type DaemonStartupCleanupResult,
} from './daemon-client-metadata.ts';
import { canConnect } from './daemon-client-transport.ts';

export type DaemonClientSettings = {
  paths: DaemonPaths;
  transportPreference: DaemonTransportPreference;
  serverMode: DaemonServerMode;
  ownedStateDir?: boolean;
  remoteBaseUrl?: string;
  remoteAuthToken?: string;
};

export type EnsuredDaemon = {
  info: DaemonInfo;
  startedByClient: boolean;
};

const DAEMON_STARTUP_TIMEOUT_MS = 15_000;
const DAEMON_STARTUP_ATTEMPTS = 2;
const LOOPBACK_BLOCK_LIST = new net.BlockList();
LOOPBACK_BLOCK_LIST.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK_BLOCK_LIST.addAddress('::1', 'ipv6');
LOOPBACK_BLOCK_LIST.addSubnet('::ffff:127.0.0.0', 104, 'ipv6');

export function resolveClientSettings(req: Omit<DaemonRequest, 'token'>): DaemonClientSettings {
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

export async function ensureDaemon(settings: DaemonClientSettings): Promise<EnsuredDaemon> {
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

  emitDaemonTakeoverNotice(existing, existingReachable, settings.paths.baseDir);
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

function emitDaemonTakeoverNotice(info: DaemonInfo, reachable: boolean, stateDir: string): void {
  try {
    const identity = info.version ? `pid ${info.pid}, v${info.version}` : `pid ${info.pid}`;
    const reason = resolveDaemonTakeoverReason(info, reachable);
    process.stderr.write(`Replacing daemon (${identity}) in ${stateDir}: ${reason}\n`);
  } catch {
    // The takeover notice is best effort; never fail the command on stderr issues.
  }
}

function resolveDaemonTakeoverReason(info: DaemonInfo, reachable: boolean): string {
  if (info.version !== readVersion()) return `version mismatch (client v${readVersion()})`;
  if (info.codeSignature !== resolveLocalDaemonCodeSignature()) return 'code-signature mismatch';
  if (!reachable) return 'unreachable';
  return 'not reusable';
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

export async function cleanupDaemonAfterRequest(
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
