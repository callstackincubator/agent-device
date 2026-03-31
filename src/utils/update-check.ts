import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCmdDetached } from './exec.ts';

const PACKAGE_NAME = 'agent-device';
const UPDATE_CHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 3500;
const UPDATE_CHECK_ARG = '--agent-device-run-update-check';
const UPDATE_CHECK_CACHE_FILE = 'update-check.json';

type UpdateCheckCache = {
  checkedAt?: string;
  latestVersion?: string;
  promptAt?: string;
  promptVersion?: string;
};

export type UpgradeNotifierOptions = {
  command: string | null;
  currentVersion: string;
  stateDir: string;
  flags: {
    help?: boolean;
    json?: boolean;
    version?: boolean;
  };
};

type UpgradeNotifierDeps = {
  now?: () => number;
  isTTY?: () => boolean;
  spawnBackgroundCheck?: (cachePath: string, currentVersion: string) => void;
  writeStderr?: (message: string) => void;
};

type UpdateCheckWorkerOptions = {
  cachePath: string;
  currentVersion: string;
  now?: () => number;
  fetchLatestVersion?: () => Promise<string | undefined>;
};

export async function maybeRunUpgradeNotifier(
  options: UpgradeNotifierOptions,
  deps: UpgradeNotifierDeps = {},
): Promise<void> {
  if (!shouldEnableUpgradeNotifier(options, deps)) return;

  const now = deps.now?.() ?? Date.now();
  const cachePath = path.join(options.stateDir, UPDATE_CHECK_CACHE_FILE);
  const cache = readUpdateCheckCache(cachePath);

  if (shouldShowUpgradeNotice(cache, options.currentVersion, now)) {
    const writeStderr = deps.writeStderr ?? process.stderr.write.bind(process.stderr);
    writeStderr(
      `Update available: ${PACKAGE_NAME} ${options.currentVersion} -> ${cache.latestVersion}. ` +
        `Run \`npm install -g ${PACKAGE_NAME}@latest\` to upgrade the CLI and bundled skills.\n`,
    );
    writeUpdateCheckCache(cachePath, {
      ...cache,
      promptAt: new Date(now).toISOString(),
      promptVersion: cache.latestVersion,
    });
  }

  if (shouldStartBackgroundCheck(cache, now)) {
    const spawnBackgroundCheck = deps.spawnBackgroundCheck ?? spawnBackgroundUpdateCheck;
    spawnBackgroundCheck(cachePath, options.currentVersion);
  }
}

export async function runUpdateCheckWorker(options: UpdateCheckWorkerOptions): Promise<void> {
  const now = options.now?.() ?? Date.now();
  const cache = readUpdateCheckCache(options.cachePath);

  try {
    const latestVersion =
      (await (options.fetchLatestVersion ?? fetchLatestPackageVersion)()) ?? undefined;
    if (!latestVersion || compareVersions(latestVersion, options.currentVersion) <= 0) {
      writeUpdateCheckCache(options.cachePath, { checkedAt: new Date(now).toISOString() });
      return;
    }

    writeUpdateCheckCache(options.cachePath, {
      checkedAt: new Date(now).toISOString(),
      latestVersion,
      promptAt: cache.latestVersion === latestVersion ? cache.promptAt : undefined,
      promptVersion: cache.latestVersion === latestVersion ? cache.promptVersion : undefined,
    });
  } catch {
    writeUpdateCheckCache(options.cachePath, {
      ...cache,
      checkedAt: new Date(now).toISOString(),
    });
  }
}

function shouldEnableUpgradeNotifier(
  options: UpgradeNotifierOptions,
  deps: Pick<UpgradeNotifierDeps, 'isTTY'>,
): boolean {
  if (!options.command) return false;
  if (options.command === 'help' || options.command === 'test') return false;
  if (options.flags.help || options.flags.version || options.flags.json) return false;
  if (process.env.CI?.trim()) return false;
  if (process.env.NODE_ENV === 'test') return false;
  if (process.env.AGENT_DEVICE_NO_UPDATE_NOTIFIER?.trim()) return false;
  const isTTY = deps.isTTY ? deps.isTTY() : Boolean(process.stderr.isTTY);
  return isTTY;
}

function shouldShowUpgradeNotice(
  cache: UpdateCheckCache,
  currentVersion: string,
  now: number,
): boolean {
  if (!cache.latestVersion) return false;
  if (compareVersions(cache.latestVersion, currentVersion) <= 0) return false;
  if (cache.promptVersion !== cache.latestVersion) return true;

  const promptAt = parseTimestamp(cache.promptAt);
  return promptAt === undefined || now - promptAt >= UPDATE_CHECK_INTERVAL_MS;
}

function shouldStartBackgroundCheck(cache: UpdateCheckCache, now: number): boolean {
  const checkedAt = parseTimestamp(cache.checkedAt);
  return checkedAt === undefined || now - checkedAt >= UPDATE_CHECK_INTERVAL_MS;
}

function readUpdateCheckCache(cachePath: string): UpdateCheckCache {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as UpdateCheckCache;
    return {
      checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : undefined,
      latestVersion: typeof raw.latestVersion === 'string' ? raw.latestVersion : undefined,
      promptAt: typeof raw.promptAt === 'string' ? raw.promptAt : undefined,
      promptVersion: typeof raw.promptVersion === 'string' ? raw.promptVersion : undefined,
    };
  } catch {
    return {};
  }
}

function writeUpdateCheckCache(cachePath: string, cache: UpdateCheckCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    // Best effort only.
  }
}

function spawnBackgroundUpdateCheck(cachePath: string, currentVersion: string): void {
  const modulePath = fileURLToPath(import.meta.url);
  const execArgs = modulePath.endsWith('.ts') ? ['--experimental-strip-types'] : [];
  runCmdDetached(process.execPath, [
    ...execArgs,
    modulePath,
    UPDATE_CHECK_ARG,
    cachePath,
    currentVersion,
  ]);
}

async function fetchLatestPackageVersion(): Promise<string | undefined> {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    headers: { accept: 'application/json' },
  });
  if (!response.ok) return undefined;

  const payload = (await response.json()) as { version?: unknown };
  return typeof payload.version === 'string' && payload.version.trim().length > 0
    ? payload.version.trim()
    : undefined;
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function compareVersions(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true });
}

function readWorkerArgs(argv: string[]): { cachePath: string; currentVersion: string } | null {
  if (argv[0] !== UPDATE_CHECK_ARG) return null;
  const cachePath = argv[1]?.trim();
  const currentVersion = argv[2]?.trim();
  if (!cachePath || !currentVersion) return null;
  return { cachePath, currentVersion };
}

if (isCurrentModuleProcessEntry()) {
  const workerArgs = readWorkerArgs(process.argv.slice(2));
  if (workerArgs) {
    void runUpdateCheckWorker(workerArgs).catch(() => {
      process.exitCode = 0;
    });
  }
}

function isCurrentModuleProcessEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  return pathToFileURL(path.resolve(entryArg)).href === import.meta.url;
}
