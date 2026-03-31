import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCmdDetached } from './exec.ts';

const DEFAULT_UPDATE_CHECK_INTERVAL_MS = 14 * 24 * 60 * 60 * 1000;
const UPDATE_CHECK_TIMEOUT_MS = 3500;
const UPDATE_CHECK_ARG = '--agent-device-run-update-check';
const UPDATE_CHECK_CACHE_FILE = 'update-check.json';
const UPDATE_CHECK_CACHE_VERSION = 1;
const UPDATE_CHECK_CACHE_PATH_ENV = 'AGENT_DEVICE_UPDATE_CHECK_CACHE_PATH';
const UPDATE_CHECK_PACKAGE_ENV = 'AGENT_DEVICE_UPDATE_CHECK_PACKAGE';
const UPDATE_CHECK_CURRENT_VERSION_ENV = 'AGENT_DEVICE_UPDATE_CHECK_CURRENT_VERSION';

type UpdateCheckCache = {
  version: number;
  packageName: string;
  currentVersion: string;
  latestVersion?: string;
  checkedAt?: string;
  lastPromptAt?: string;
  notifiedVersion?: string;
};

export type UpgradeNotifierOptions = {
  command: string | null;
  packageName: string;
  currentVersion: string;
  stateDir: string;
  flags: {
    help?: boolean;
    json?: boolean;
    version?: boolean;
  };
  env?: Record<string, string | undefined>;
};

type UpgradeNotifierDeps = {
  now?: () => number;
  isTTY?: () => boolean;
  spawnBackgroundCheck?: (options: BackgroundUpdateCheckOptions) => void;
  writeStderr?: (message: string) => void;
};

type BackgroundUpdateCheckOptions = {
  cachePath: string;
  packageName: string;
  currentVersion: string;
  env?: Record<string, string | undefined>;
};

type UpdateCheckWorkerOptions = BackgroundUpdateCheckOptions & {
  now?: () => number;
  fetchLatestVersion?: (packageName: string) => Promise<string | undefined>;
};

export async function maybeRunUpgradeNotifier(
  options: UpgradeNotifierOptions,
  deps: UpgradeNotifierDeps = {},
): Promise<void> {
  if (!shouldEnableUpgradeNotifier(options, deps)) return;
  const now = deps.now?.() ?? Date.now();
  const cachePath = resolveUpdateCheckCachePath(options.stateDir);
  const cache = readUpdateCheckCache(cachePath);
  if (shouldPromptForUpgrade(cache, options.currentVersion, now)) {
    const writeStderr = deps.writeStderr ?? process.stderr.write.bind(process.stderr);
    writeStderr(
      formatUpgradeNotice({
        packageName: options.packageName,
        currentVersion: options.currentVersion,
        latestVersion: cache.latestVersion as string,
      }),
    );
    writeUpdateCheckCache(cachePath, {
      ...cache,
      lastPromptAt: new Date(now).toISOString(),
      notifiedVersion: cache.latestVersion,
    });
  }
  if (!shouldStartBackgroundCheck(cache, now)) return;
  const spawnBackgroundCheck = deps.spawnBackgroundCheck ?? spawnBackgroundUpdateCheck;
  spawnBackgroundCheck({
    cachePath,
    packageName: options.packageName,
    currentVersion: options.currentVersion,
    env: options.env,
  });
}

export async function runUpdateCheckWorker(options: UpdateCheckWorkerOptions): Promise<void> {
  const now = options.now?.() ?? Date.now();
  const existing = readUpdateCheckCache(options.cachePath);
  try {
    const latestVersion =
      (await (options.fetchLatestVersion ?? fetchLatestPackageVersion)(options.packageName)) ??
      undefined;
    if (!latestVersion) {
      writeUpdateCheckCache(options.cachePath, {
        ...existing,
        version: UPDATE_CHECK_CACHE_VERSION,
        packageName: options.packageName,
        currentVersion: options.currentVersion,
        checkedAt: new Date(now).toISOString(),
      });
      return;
    }
    const updateAvailable = compareVersions(latestVersion, options.currentVersion) > 0;
    const sameLatest = existing.latestVersion === latestVersion;
    writeUpdateCheckCache(options.cachePath, {
      version: UPDATE_CHECK_CACHE_VERSION,
      packageName: options.packageName,
      currentVersion: options.currentVersion,
      latestVersion: updateAvailable ? latestVersion : undefined,
      checkedAt: new Date(now).toISOString(),
      lastPromptAt: updateAvailable && sameLatest ? existing.lastPromptAt : undefined,
      notifiedVersion: updateAvailable && sameLatest ? existing.notifiedVersion : undefined,
    });
  } catch {
    writeUpdateCheckCache(options.cachePath, {
      ...existing,
      version: UPDATE_CHECK_CACHE_VERSION,
      packageName: options.packageName,
      currentVersion: options.currentVersion,
      checkedAt: new Date(now).toISOString(),
    });
  }
}

export function shouldRunUpdateCheckWorker(argv: string[]): boolean {
  return argv.includes(UPDATE_CHECK_ARG);
}

function shouldEnableUpgradeNotifier(
  options: UpgradeNotifierOptions,
  deps: Pick<UpgradeNotifierDeps, 'isTTY'>,
): boolean {
  const env = options.env ?? process.env;
  if (!options.command) return false;
  if (options.command === 'help' || options.command === 'test') return false;
  if (options.flags.help || options.flags.version || options.flags.json) return false;
  if (env.CI?.trim()) return false;
  if (env.NODE_ENV === 'test') return false;
  if (env.AGENT_DEVICE_NO_UPDATE_NOTIFIER?.trim()) return false;
  const isTTY = deps.isTTY ? deps.isTTY() : Boolean(process.stderr.isTTY);
  return isTTY;
}

function shouldPromptForUpgrade(
  cache: UpdateCheckCache,
  currentVersion: string,
  now: number,
): boolean {
  if (!cache.latestVersion) return false;
  if (compareVersions(cache.latestVersion, currentVersion) <= 0) return false;
  if (cache.notifiedVersion !== cache.latestVersion) return true;
  const lastPromptAt = parseTimestamp(cache.lastPromptAt);
  if (!lastPromptAt) return true;
  return now - lastPromptAt >= DEFAULT_UPDATE_CHECK_INTERVAL_MS;
}

function shouldStartBackgroundCheck(cache: UpdateCheckCache, now: number): boolean {
  const checkedAt = parseTimestamp(cache.checkedAt);
  if (!checkedAt) return true;
  return now - checkedAt >= DEFAULT_UPDATE_CHECK_INTERVAL_MS;
}

function formatUpgradeNotice(options: {
  packageName: string;
  currentVersion: string;
  latestVersion: string;
}): string {
  return (
    `Update available: ${options.packageName} ${options.currentVersion} -> ${options.latestVersion}. ` +
    `Run \`npm install -g ${options.packageName}@latest\` to upgrade the CLI and bundled skills.\n`
  );
}

function resolveUpdateCheckCachePath(stateDir: string): string {
  return path.join(stateDir, UPDATE_CHECK_CACHE_FILE);
}

function readUpdateCheckCache(cachePath: string): UpdateCheckCache {
  try {
    const raw = fs.readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<UpdateCheckCache>;
    if (!parsed || typeof parsed !== 'object') {
      return createEmptyUpdateCheckCache();
    }
    return {
      version: typeof parsed.version === 'number' ? parsed.version : UPDATE_CHECK_CACHE_VERSION,
      packageName: typeof parsed.packageName === 'string' ? parsed.packageName : 'agent-device',
      currentVersion: typeof parsed.currentVersion === 'string' ? parsed.currentVersion : '0.0.0',
      latestVersion: typeof parsed.latestVersion === 'string' ? parsed.latestVersion : undefined,
      checkedAt: typeof parsed.checkedAt === 'string' ? parsed.checkedAt : undefined,
      lastPromptAt: typeof parsed.lastPromptAt === 'string' ? parsed.lastPromptAt : undefined,
      notifiedVersion:
        typeof parsed.notifiedVersion === 'string' ? parsed.notifiedVersion : undefined,
    };
  } catch {
    return createEmptyUpdateCheckCache();
  }
}

function writeUpdateCheckCache(cachePath: string, cache: UpdateCheckCache): void {
  try {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  } catch {
    // Best effort only. Upgrade checks must never break normal CLI commands.
  }
}

function createEmptyUpdateCheckCache(): UpdateCheckCache {
  return {
    version: UPDATE_CHECK_CACHE_VERSION,
    packageName: 'agent-device',
    currentVersion: '0.0.0',
  };
}

function spawnBackgroundUpdateCheck(options: BackgroundUpdateCheckOptions): void {
  const modulePath = fileURLToPath(import.meta.url);
  const execArgs = modulePath.endsWith('.ts') ? ['--experimental-strip-types'] : [];
  runCmdDetached(process.execPath, [...execArgs, modulePath, UPDATE_CHECK_ARG], {
    env: {
      ...process.env,
      ...options.env,
      [UPDATE_CHECK_CACHE_PATH_ENV]: options.cachePath,
      [UPDATE_CHECK_PACKAGE_ENV]: options.packageName,
      [UPDATE_CHECK_CURRENT_VERSION_ENV]: options.currentVersion,
    },
  });
}

async function fetchLatestPackageVersion(packageName: string): Promise<string | undefined> {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(packageName)}/latest`,
    {
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
      headers: {
        accept: 'application/json',
      },
    },
  );
  if (!response.ok) {
    return undefined;
  }
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
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return left.localeCompare(right, undefined, { numeric: true });
  for (let index = 0; index < 3; index += 1) {
    const diff = leftParts.numbers[index] - rightParts.numbers[index];
    if (diff !== 0) return diff;
  }
  return comparePrerelease(leftParts.prerelease, rightParts.prerelease);
}

function comparePrerelease(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;
  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index];
    const rightPart = right[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const leftIsNumber = Number.isInteger(leftNumber) && leftPart === String(leftNumber);
    const rightIsNumber = Number.isInteger(rightNumber) && rightPart === String(rightNumber);
    if (leftIsNumber && rightIsNumber) {
      const diff = leftNumber - rightNumber;
      if (diff !== 0) return diff;
      continue;
    }
    if (leftIsNumber) return -1;
    if (rightIsNumber) return 1;
    const diff = leftPart.localeCompare(rightPart);
    if (diff !== 0) return diff;
  }
  return 0;
}

function parseVersion(
  value: string,
): { numbers: [number, number, number]; prerelease: string[] } | null {
  const match = value
    .trim()
    .match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

async function runUpdateCheckWorkerFromEnv(env: NodeJS.ProcessEnv): Promise<void> {
  const cachePath = env[UPDATE_CHECK_CACHE_PATH_ENV]?.trim();
  const packageName = env[UPDATE_CHECK_PACKAGE_ENV]?.trim();
  const currentVersion = env[UPDATE_CHECK_CURRENT_VERSION_ENV]?.trim();
  if (!cachePath || !packageName || !currentVersion) return;
  await runUpdateCheckWorker({
    cachePath,
    packageName,
    currentVersion,
  });
}

if (isCurrentModuleProcessEntry() && shouldRunUpdateCheckWorker(process.argv.slice(2))) {
  void runUpdateCheckWorkerFromEnv(process.env).catch(() => {
    process.exitCode = 0;
  });
}

function isCurrentModuleProcessEntry(): boolean {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  return pathToFileURL(path.resolve(entryArg)).href === import.meta.url;
}
