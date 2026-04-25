import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENV_BEARER_TOKEN,
  ENV_DEVICE_PORT,
  ENV_LAUNCH_URL,
  ENV_LOCAL_BASE_URL,
  ENV_REGISTER_PATH,
  ENV_SERVER_BASE_URL,
  ENV_SESSION,
  ENV_SCOPE_LEASE_ID,
  ENV_SCOPE_RUN_ID,
  ENV_SCOPE_TENANT_ID,
  ENV_STATE_PATH,
  ENV_UNREGISTER_PATH,
  METRO_COMPANION_RUN_ARG,
  REACT_DEVTOOLS_COMPANION_RUN_ARG,
} from './client-metro-companion-contract.ts';
import type { MetroBridgeScope } from './client-metro-companion-contract.ts';
import { normalizeBaseUrl } from './utils/url.ts';
import { runCmdDetached } from './utils/exec.ts';
import {
  isProcessAlive,
  readProcessCommand,
  readProcessStartTime,
  waitForProcessExit,
} from './utils/process-identity.ts';

const METRO_COMPANION_TERM_TIMEOUT_MS = 1_000;
const METRO_COMPANION_KILL_TIMEOUT_MS = 1_000;
const METRO_COMPANION_STATE_FILE = 'metro-companion.json';
const METRO_COMPANION_LOG_FILE = 'metro-companion.log';
const METRO_COMPANION_STATE_DIR = 'metro-companion';
const REACT_DEVTOOLS_COMPANION_STATE_FILE = 'react-devtools-companion.json';
const REACT_DEVTOOLS_COMPANION_LOG_FILE = 'react-devtools-companion.log';
const REACT_DEVTOOLS_COMPANION_STATE_DIR = 'react-devtools-companion';

type CompanionKind = 'metro' | 'react-devtools';

type CompanionState = {
  pid: number;
  startTime?: string;
  command?: string;
  serverBaseUrl: string;
  localBaseUrl: string;
  launchUrl?: string;
  registerPath?: string;
  unregisterPath?: string;
  devicePort?: number;
  session?: string;
  bridgeScope?: MetroBridgeScope;
  tokenHash: string;
  consumers: string[];
};

export type EnsureMetroCompanionOptions = {
  projectRoot: string;
  serverBaseUrl: string;
  bearerToken: string;
  localBaseUrl: string;
  bridgeScope: MetroBridgeScope;
  kind?: CompanionKind;
  launchUrl?: string;
  registerPath?: string;
  unregisterPath?: string;
  devicePort?: number;
  session?: string;
  profileKey?: string;
  consumerKey?: string;
  stateDir?: string;
  env?: NodeJS.ProcessEnv;
};

export type EnsureMetroCompanionResult = {
  pid: number;
  spawned: boolean;
  statePath: string;
  logPath: string;
};

export type StopMetroCompanionOptions = {
  projectRoot: string;
  kind?: CompanionKind;
  stateDir?: string;
  profileKey?: string;
  consumerKey?: string;
};

function hashString(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeOptionalString(input: string | undefined): string | undefined {
  return input?.trim() ? input.trim() : undefined;
}

function readCompanionScope(input: unknown): MetroBridgeScope | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const record = input as Partial<MetroBridgeScope>;
  if (
    typeof record.tenantId !== 'string' ||
    typeof record.runId !== 'string' ||
    typeof record.leaseId !== 'string'
  ) {
    return undefined;
  }
  return {
    tenantId: record.tenantId,
    runId: record.runId,
    leaseId: record.leaseId,
  };
}

function areCompanionScopesEqual(a: MetroBridgeScope, b: MetroBridgeScope): boolean {
  return a.tenantId === b.tenantId && a.runId === b.runId && a.leaseId === b.leaseId;
}

function companionStateNames(kind: CompanionKind): {
  stateFile: string;
  logFile: string;
  stateDir: string;
} {
  if (kind === 'react-devtools') {
    return {
      stateFile: REACT_DEVTOOLS_COMPANION_STATE_FILE,
      logFile: REACT_DEVTOOLS_COMPANION_LOG_FILE,
      stateDir: REACT_DEVTOOLS_COMPANION_STATE_DIR,
    };
  }
  return {
    stateFile: METRO_COMPANION_STATE_FILE,
    logFile: METRO_COMPANION_LOG_FILE,
    stateDir: METRO_COMPANION_STATE_DIR,
  };
}

function resolveCompanionPaths(
  projectRoot: string,
  profileKey?: string,
  kind: CompanionKind = 'metro',
  stateDir?: string,
): { statePath: string; logPath: string } {
  const names = companionStateNames(kind);
  const dir = stateDir ?? path.join(projectRoot, '.agent-device');
  if (!profileKey) {
    return {
      statePath: path.join(dir, names.stateFile),
      logPath: path.join(dir, names.logFile),
    };
  }
  const profileHash = hashString(profileKey).slice(0, 12);
  const profileDir = path.join(dir, names.stateDir);
  return {
    statePath: path.join(profileDir, `${names.stateDir}-${profileHash}.json`),
    logPath: path.join(profileDir, `${names.stateDir}-${profileHash}.log`),
  };
}

function readCompanionState(statePath: string): CompanionState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8')) as Partial<CompanionState>;
    if (!Number.isInteger(parsed.pid) || Number(parsed.pid) <= 0) return null;
    if (typeof parsed.serverBaseUrl !== 'string' || typeof parsed.localBaseUrl !== 'string') {
      return null;
    }
    if (typeof parsed.tokenHash !== 'string' || parsed.tokenHash.length === 0) return null;
    const consumers = Array.isArray(parsed.consumers)
      ? parsed.consumers.filter(
          (entry): entry is string => typeof entry === 'string' && entry.length > 0,
        )
      : [];
    return {
      pid: Number(parsed.pid),
      startTime: typeof parsed.startTime === 'string' ? parsed.startTime : undefined,
      command: typeof parsed.command === 'string' ? parsed.command : undefined,
      serverBaseUrl: parsed.serverBaseUrl,
      localBaseUrl: parsed.localBaseUrl,
      launchUrl: normalizeOptionalString(
        typeof parsed.launchUrl === 'string' ? parsed.launchUrl : undefined,
      ),
      registerPath: normalizeOptionalString(
        typeof parsed.registerPath === 'string' ? parsed.registerPath : undefined,
      ),
      unregisterPath: normalizeOptionalString(
        typeof parsed.unregisterPath === 'string' ? parsed.unregisterPath : undefined,
      ),
      devicePort: Number.isInteger(parsed.devicePort) ? Number(parsed.devicePort) : undefined,
      session: normalizeOptionalString(
        typeof parsed.session === 'string' ? parsed.session : undefined,
      ),
      bridgeScope: readCompanionScope(parsed.bridgeScope),
      tokenHash: parsed.tokenHash,
      consumers,
    };
  } catch {
    return null;
  }
}

function writeCompanionState(statePath: string, state: CompanionState): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function clearCompanionState(statePath: string): void {
  try {
    fs.unlinkSync(statePath);
  } catch {
    // best effort cleanup
  }
}

function clearCompanionLog(logPath: string): void {
  try {
    fs.unlinkSync(logPath);
  } catch {
    // best effort cleanup
  }
}

function removeDirectoryIfEmpty(dirPath: string): void {
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // best effort cleanup
  }
}

function clearCompanionArtifacts(paths: { statePath: string; logPath: string }): void {
  const stateDir = path.dirname(paths.statePath);
  const logDir = path.dirname(paths.logPath);
  clearCompanionState(paths.statePath);
  clearCompanionLog(paths.logPath);
  removeDirectoryIfEmpty(stateDir);
  if (logDir !== stateDir) {
    removeDirectoryIfEmpty(logDir);
  }
  if (path.basename(stateDir) === METRO_COMPANION_STATE_DIR) {
    removeDirectoryIfEmpty(path.dirname(stateDir));
  }
}

function isMetroCompanionCommand(command: string): boolean {
  return (
    command.includes(METRO_COMPANION_RUN_ARG) || command.includes(REACT_DEVTOOLS_COMPANION_RUN_ARG)
  );
}

function shouldReuseCompanion(
  state: CompanionState,
  options: EnsureMetroCompanionOptions,
): boolean {
  if (!isProcessAlive(state.pid)) return false;
  if (state.startTime) {
    const currentStartTime = readProcessStartTime(state.pid);
    if (!currentStartTime || currentStartTime !== state.startTime) return false;
  }
  const command = readProcessCommand(state.pid);
  if (!command || !isMetroCompanionCommand(command)) return false;
  if (!state.bridgeScope) return false;
  return (
    state.serverBaseUrl === normalizeBaseUrl(options.serverBaseUrl) &&
    state.localBaseUrl === normalizeBaseUrl(options.localBaseUrl) &&
    state.launchUrl === normalizeOptionalString(options.launchUrl) &&
    state.registerPath === normalizeOptionalString(options.registerPath) &&
    state.unregisterPath === normalizeOptionalString(options.unregisterPath) &&
    state.devicePort === options.devicePort &&
    state.session === normalizeOptionalString(options.session) &&
    areCompanionScopesEqual(state.bridgeScope, options.bridgeScope) &&
    state.tokenHash === hashString(options.bearerToken)
  );
}

function resolveConsumerKey(options: { profileKey?: string; consumerKey?: string }): string | null {
  return (
    normalizeOptionalString(options.consumerKey) ??
    normalizeOptionalString(options.profileKey) ??
    null
  );
}

function withConsumer(state: CompanionState, consumerKey: string | null): CompanionState {
  if (!consumerKey || state.consumers.includes(consumerKey)) {
    return state;
  }
  return {
    ...state,
    consumers: [...state.consumers, consumerKey],
  };
}

function withoutConsumer(state: CompanionState, consumerKey: string | null): CompanionState {
  if (!consumerKey) {
    return {
      ...state,
      consumers: [],
    };
  }
  return {
    ...state,
    consumers: state.consumers.filter((entry) => entry !== consumerKey),
  };
}

async function stopCompanionProcess(state: CompanionState): Promise<void> {
  if (!isProcessAlive(state.pid)) return;
  const command = readProcessCommand(state.pid);
  if (!command || !isMetroCompanionCommand(command)) return;
  try {
    process.kill(state.pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return;
    throw error;
  }
  if (await waitForProcessExit(state.pid, METRO_COMPANION_TERM_TIMEOUT_MS)) return;
  try {
    process.kill(state.pid, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || code === 'EPERM') return;
    throw error;
  }
  await waitForProcessExit(state.pid, METRO_COMPANION_KILL_TIMEOUT_MS);
}

function buildCompanionEnv(
  options: EnsureMetroCompanionOptions,
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {
    ...env,
    [ENV_SERVER_BASE_URL]: normalizeBaseUrl(options.serverBaseUrl),
    [ENV_BEARER_TOKEN]: options.bearerToken,
    [ENV_LOCAL_BASE_URL]: normalizeBaseUrl(options.localBaseUrl),
    [ENV_STATE_PATH]: resolveCompanionPaths(
      options.projectRoot,
      options.profileKey,
      options.kind,
      options.stateDir,
    ).statePath,
  };
  nextEnv[ENV_SCOPE_TENANT_ID] = options.bridgeScope.tenantId;
  nextEnv[ENV_SCOPE_RUN_ID] = options.bridgeScope.runId;
  nextEnv[ENV_SCOPE_LEASE_ID] = options.bridgeScope.leaseId;
  if (options.launchUrl?.trim()) {
    nextEnv[ENV_LAUNCH_URL] = options.launchUrl.trim();
  } else {
    delete nextEnv[ENV_LAUNCH_URL];
  }
  if (options.registerPath?.trim()) {
    nextEnv[ENV_REGISTER_PATH] = options.registerPath.trim();
  } else {
    delete nextEnv[ENV_REGISTER_PATH];
  }
  if (options.unregisterPath?.trim()) {
    nextEnv[ENV_UNREGISTER_PATH] = options.unregisterPath.trim();
  } else {
    delete nextEnv[ENV_UNREGISTER_PATH];
  }
  if (options.devicePort !== undefined) {
    nextEnv[ENV_DEVICE_PORT] = String(options.devicePort);
  } else {
    delete nextEnv[ENV_DEVICE_PORT];
  }
  if (options.session?.trim()) {
    nextEnv[ENV_SESSION] = options.session.trim();
  } else {
    delete nextEnv[ENV_SESSION];
  }
  return nextEnv;
}

function resolveCompanionEntryModulePath(): string {
  const currentModulePath = fileURLToPath(import.meta.url);
  const extension = path.extname(currentModulePath) || '.js';
  const entryPath = path.join(path.dirname(currentModulePath), `metro-companion${extension}`);
  if (!fs.existsSync(entryPath)) {
    throw new Error(
      `Metro companion entrypoint not found at ${entryPath}. Rebuild the package to include the companion worker entry.`,
    );
  }
  return entryPath;
}

function spawnCompanionProcess(
  options: EnsureMetroCompanionOptions,
  logPath: string,
): CompanionState {
  const modulePath = resolveCompanionEntryModulePath();
  const execArgs = modulePath.endsWith('.ts') ? ['--experimental-strip-types'] : [];
  const runArg =
    options.kind === 'react-devtools' ? REACT_DEVTOOLS_COMPANION_RUN_ARG : METRO_COMPANION_RUN_ARG;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');
  let pid = 0;
  try {
    pid = runCmdDetached(process.execPath, [...execArgs, modulePath, runArg], {
      env: buildCompanionEnv(options, options.env ?? process.env),
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    fs.closeSync(logFd);
  }
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('Failed to start Metro companion process.');
  }
  return {
    pid,
    startTime: readProcessStartTime(pid) ?? undefined,
    command: readProcessCommand(pid) ?? undefined,
    serverBaseUrl: normalizeBaseUrl(options.serverBaseUrl),
    localBaseUrl: normalizeBaseUrl(options.localBaseUrl),
    launchUrl: normalizeOptionalString(options.launchUrl),
    registerPath: normalizeOptionalString(options.registerPath),
    unregisterPath: normalizeOptionalString(options.unregisterPath),
    devicePort: options.devicePort,
    session: normalizeOptionalString(options.session),
    bridgeScope: options.bridgeScope,
    tokenHash: hashString(options.bearerToken),
    consumers: [],
  };
}

export async function ensureMetroCompanion(
  options: EnsureMetroCompanionOptions,
): Promise<EnsureMetroCompanionResult> {
  const consumerKey = resolveConsumerKey(options);
  const paths = resolveCompanionPaths(
    options.projectRoot,
    options.profileKey,
    options.kind,
    options.stateDir,
  );
  const existing = readCompanionState(paths.statePath);
  if (existing && shouldReuseCompanion(existing, options)) {
    const nextState = withConsumer(existing, consumerKey);
    if (nextState !== existing) {
      writeCompanionState(paths.statePath, nextState);
    }
    return {
      pid: existing.pid,
      spawned: false,
      statePath: paths.statePath,
      logPath: paths.logPath,
    };
  }

  if (existing) {
    await stopCompanionProcess(existing);
    clearCompanionArtifacts(paths);
  }

  const spawned = spawnCompanionProcess(options, paths.logPath);
  writeCompanionState(paths.statePath, withConsumer(spawned, consumerKey));
  return {
    pid: spawned.pid,
    spawned: true,
    statePath: paths.statePath,
    logPath: paths.logPath,
  };
}

export async function stopMetroCompanion(
  options: StopMetroCompanionOptions,
): Promise<{ stopped: boolean; statePath: string }> {
  const consumerKey = resolveConsumerKey(options);
  const paths = resolveCompanionPaths(
    options.projectRoot,
    options.profileKey,
    options.kind,
    options.stateDir,
  );
  const existing = readCompanionState(paths.statePath);
  if (!existing) {
    clearCompanionArtifacts(paths);
    return { stopped: false, statePath: paths.statePath };
  }
  const nextState = withoutConsumer(existing, consumerKey);
  if (nextState.consumers.length > 0) {
    writeCompanionState(paths.statePath, nextState);
    return { stopped: false, statePath: paths.statePath };
  }
  await stopCompanionProcess(existing);
  clearCompanionArtifacts(paths);
  return { stopped: true, statePath: paths.statePath };
}
