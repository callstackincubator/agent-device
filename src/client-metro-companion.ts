import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ENV_BEARER_TOKEN,
  ENV_LAUNCH_URL,
  ENV_LOCAL_BASE_URL,
  ENV_SERVER_BASE_URL,
  METRO_COMPANION_RUN_ARG,
} from './client-metro-companion-contract.ts';
import { runMetroCompanionProcessFromEnv } from './client-metro-companion-worker.ts';
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

type CompanionState = {
  pid: number;
  startTime?: string;
  command?: string;
  serverBaseUrl: string;
  localBaseUrl: string;
  launchUrl?: string;
  tokenHash: string;
  consumers: string[];
};

export type EnsureMetroCompanionOptions = {
  projectRoot: string;
  serverBaseUrl: string;
  bearerToken: string;
  localBaseUrl: string;
  launchUrl?: string;
  profileKey?: string;
  consumerKey?: string;
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
  profileKey?: string;
  consumerKey?: string;
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normalizeOptionalString(input: string | undefined): string | undefined {
  return input?.trim() ? input.trim() : undefined;
}

function hashValue(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function resolveCompanionPaths(
  projectRoot: string,
  profileKey?: string,
): { statePath: string; logPath: string } {
  const dir = path.join(projectRoot, '.agent-device');
  if (!profileKey) {
    return {
      statePath: path.join(dir, METRO_COMPANION_STATE_FILE),
      logPath: path.join(dir, METRO_COMPANION_LOG_FILE),
    };
  }
  const profileHash = hashValue(profileKey).slice(0, 12);
  const profileDir = path.join(dir, METRO_COMPANION_STATE_DIR);
  return {
    statePath: path.join(profileDir, `metro-companion-${profileHash}.json`),
    logPath: path.join(profileDir, `metro-companion-${profileHash}.log`),
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

function isMetroCompanionCommand(command: string): boolean {
  return command.includes(METRO_COMPANION_RUN_ARG);
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
  return (
    state.serverBaseUrl === normalizeBaseUrl(options.serverBaseUrl) &&
    state.localBaseUrl === normalizeBaseUrl(options.localBaseUrl) &&
    state.launchUrl === normalizeOptionalString(options.launchUrl) &&
    state.tokenHash === hashToken(options.bearerToken)
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
  };
  if (options.launchUrl?.trim()) {
    nextEnv[ENV_LAUNCH_URL] = options.launchUrl.trim();
  } else {
    delete nextEnv[ENV_LAUNCH_URL];
  }
  return nextEnv;
}

function spawnCompanionProcess(
  options: EnsureMetroCompanionOptions,
  logPath: string,
): CompanionState {
  const modulePath = fileURLToPath(import.meta.url);
  const execArgs = modulePath.endsWith('.ts') ? ['--experimental-strip-types'] : [];
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const logFd = fs.openSync(logPath, 'a');
  let pid = 0;
  try {
    pid = runCmdDetached(process.execPath, [...execArgs, modulePath, METRO_COMPANION_RUN_ARG], {
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
    tokenHash: hashToken(options.bearerToken),
    consumers: [],
  };
}

export async function ensureMetroCompanion(
  options: EnsureMetroCompanionOptions,
): Promise<EnsureMetroCompanionResult> {
  const consumerKey = resolveConsumerKey(options);
  const paths = resolveCompanionPaths(options.projectRoot, options.profileKey);
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
    clearCompanionState(paths.statePath);
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
  const paths = resolveCompanionPaths(options.projectRoot, options.profileKey);
  const existing = readCompanionState(paths.statePath);
  if (!existing) {
    clearCompanionState(paths.statePath);
    return { stopped: false, statePath: paths.statePath };
  }
  const nextState = withoutConsumer(existing, consumerKey);
  if (nextState.consumers.length > 0) {
    writeCompanionState(paths.statePath, nextState);
    return { stopped: false, statePath: paths.statePath };
  }
  await stopCompanionProcess(existing);
  clearCompanionState(paths.statePath);
  return { stopped: true, statePath: paths.statePath };
}

function isCurrentModuleProcessEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  return pathToFileURL(path.resolve(entryArg)).href === import.meta.url;
}

if (isCurrentModuleProcessEntry()) {
  void runMetroCompanionProcessFromEnv(process.argv.slice(2), process.env).catch((error) => {
    if (error instanceof Error && error.message.includes('missing required environment')) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  });
}
