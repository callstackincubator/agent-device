import { existsSync, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import type { SessionSurface } from '../../core/session-surface.ts';

export type MacOsPermissionTarget = 'accessibility' | 'screen-recording' | 'input-monitoring';

// Keep this shape aligned with macOS helper SnapshotNodeResponse in
// macos-helper/Sources/AgentDeviceMacOSHelper/SnapshotTraversal.swift.
export type MacOsSnapshotNode = {
  index: number;
  type?: string;
  role?: string;
  subrole?: string;
  label?: string;
  value?: string;
  identifier?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  enabled?: boolean;
  selected?: boolean;
  hittable?: boolean;
  depth?: number;
  parentIndex?: number;
  pid?: number;
  bundleId?: string;
  appName?: string;
  windowTitle?: string;
  surface?: string;
};

type HelperSuccess<T extends Record<string, unknown>> = {
  ok: true;
  data: T;
};

type HelperFailure = {
  ok: false;
  error?: {
    message?: string;
    details?: Record<string, unknown>;
  };
};

type HelperResult<T extends Record<string, unknown>> = HelperSuccess<T> | HelperFailure;

const MACOS_HELPER_PRODUCT_NAME = 'agent-device-macos-helper';
const MACOS_HELPER_ENV_PATH = 'AGENT_DEVICE_MACOS_HELPER_BIN';
const MACOS_HELPER_INSTALL_ROOT = path.join(
  os.homedir(),
  '.agent-device',
  'macos-helper',
  'current',
);
const MACOS_HELPER_MANIFEST_PATH = path.join(MACOS_HELPER_INSTALL_ROOT, 'manifest.json');
const MACOS_BUNDLE_ID_PATTERN = /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/;

function assertMacOsBundleId(bundleId: string): string {
  const normalized = bundleId.trim();
  if (!MACOS_BUNDLE_ID_PATTERN.test(normalized)) {
    throw new AppError(
      'INVALID_ARGS',
      'macOS bundle id must use reverse-DNS form like com.example.App',
      { bundleId },
    );
  }
  return normalized;
}

export function resolveMacOsHelperPackageRootFrom(modulePath: string): string {
  let currentDir = path.dirname(modulePath);
  while (true) {
    const candidate = path.join(currentDir, 'macos-helper');
    if (existsSync(path.join(candidate, 'Package.swift'))) {
      return candidate;
    }
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }
  throw new AppError('COMMAND_FAILED', 'Unable to locate macOS helper package root', {
    modulePath,
  });
}

function resolveMacOsHelperPackageRoot(): string {
  return resolveMacOsHelperPackageRootFrom(fileURLToPath(import.meta.url));
}

function resolveMacOsHelperSourceBinaryPath(): string {
  return path.join(resolveMacOsHelperPackageRoot(), '.build', 'release', MACOS_HELPER_PRODUCT_NAME);
}

function resolveInstalledMacOsHelperPath(): string {
  return path.join(MACOS_HELPER_INSTALL_ROOT, MACOS_HELPER_PRODUCT_NAME);
}

async function listMacOsHelperSourceFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.build') return [];
        return await listMacOsHelperSourceFiles(entryPath);
      }
      if (!entry.isFile()) return [];
      if (!entry.name.endsWith('.swift') && entry.name !== 'Package.swift') return [];
      return [entryPath];
    }),
  );
  return files.flat().sort();
}

async function computeMacOsHelperFingerprint(packageRoot: string): Promise<string> {
  const files = await listMacOsHelperSourceFiles(packageRoot);
  const hash = createHash('sha256');
  for (const filePath of files) {
    hash.update(path.relative(packageRoot, filePath));
    hash.update('\0');
    hash.update(await fs.readFile(filePath));
    hash.update('\0');
  }
  const swiftVersion = await runCmd('swift', ['--version'], {
    allowFailure: true,
    cwd: packageRoot,
    timeoutMs: 10_000,
  });
  hash.update('swift-version');
  hash.update('\0');
  hash.update(swiftVersion.stdout || swiftVersion.stderr || `exit:${swiftVersion.exitCode}`);
  hash.update('\0');
  return hash.digest('hex');
}

async function readInstalledMacOsHelperFingerprint(): Promise<string | null> {
  try {
    const data = JSON.parse(await fs.readFile(MACOS_HELPER_MANIFEST_PATH, 'utf8')) as {
      fingerprint?: unknown;
    };
    return typeof data.fingerprint === 'string' ? data.fingerprint : null;
  } catch {
    return null;
  }
}

async function ensureMacOsHelperBinary(): Promise<string> {
  const configuredPath = process.env[MACOS_HELPER_ENV_PATH]?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const packageRoot = resolveMacOsHelperPackageRoot();
  const sourceFingerprint = await computeMacOsHelperFingerprint(packageRoot);
  const installedPath = resolveInstalledMacOsHelperPath();
  try {
    const installedFingerprint = await readInstalledMacOsHelperFingerprint();
    if (installedFingerprint === sourceFingerprint) {
      await fs.access(installedPath);
      return installedPath;
    }
  } catch {
    // Build/install below.
  }

  const sourceBinary = resolveMacOsHelperSourceBinaryPath();
  process.stderr.write('agent-device: building macOS helper (first run or helper update)\n');
  await runCmd('swift', ['build', '-c', 'release', '--package-path', packageRoot], {
    cwd: packageRoot,
    timeoutMs: 120_000,
  });
  await fs.mkdir(MACOS_HELPER_INSTALL_ROOT, { recursive: true });
  const tempInstalledPath = `${installedPath}.tmp`;
  await fs.copyFile(sourceBinary, tempInstalledPath);
  await fs.rename(tempInstalledPath, installedPath);
  await fs.chmod(installedPath, 0o755);
  await fs.writeFile(
    MACOS_HELPER_MANIFEST_PATH,
    `${JSON.stringify({ fingerprint: sourceFingerprint }, null, 2)}\n`,
    'utf8',
  );
  return installedPath;
}

async function runMacOsHelper<T extends Record<string, unknown>>(args: string[]): Promise<T> {
  const configuredPath = process.env[MACOS_HELPER_ENV_PATH]?.trim();
  if (process.platform !== 'darwin' && !configuredPath) {
    throw new AppError('UNSUPPORTED_PLATFORM', 'macOS helper is only available on macOS');
  }
  const helperPath = await ensureMacOsHelperBinary();
  const result = await runCmd(helperPath, args, { allowFailure: true, timeoutMs: 30_000 });
  const stdout = result.stdout.trim();
  let parsed: HelperResult<T> | null = null;
  if (stdout) {
    try {
      parsed = JSON.parse(stdout) as HelperResult<T>;
    } catch {
      parsed = null;
    }
  }

  if (result.exitCode === 0 && parsed?.ok) {
    return parsed.data;
  }

  const message =
    parsed && !parsed.ok
      ? (parsed.error?.message ?? `macOS helper exited with code ${result.exitCode}`)
      : stdout || result.stderr.trim() || `macOS helper exited with code ${result.exitCode}`;
  throw new AppError('COMMAND_FAILED', message, {
    helperPath,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    ...(parsed && !parsed.ok ? parsed.error?.details : {}),
  });
}

export async function resolveFrontmostMacOsApp(): Promise<{
  bundleId?: string;
  appName?: string;
  pid?: number;
}> {
  return await runMacOsHelper(['app', 'frontmost']);
}

export async function quitMacOsApp(bundleId: string): Promise<{
  bundleId: string;
  running: boolean;
  terminated: boolean;
  forceTerminated: boolean;
}> {
  return await runMacOsHelper(['app', 'quit', '--bundle-id', assertMacOsBundleId(bundleId)]);
}

export async function runMacOsPermissionAction(
  action: 'grant' | 'reset',
  target: MacOsPermissionTarget,
): Promise<{
  target: MacOsPermissionTarget;
  granted: boolean;
  requested: boolean;
  openedSettings: boolean;
  action: 'grant' | 'reset';
  message?: string;
}> {
  return await runMacOsHelper(['permission', action, target]);
}

export async function runMacOsAlertAction(
  action: 'get' | 'accept' | 'dismiss',
  options: { bundleId?: string; surface?: SessionSurface } = {},
): Promise<{
  title?: string;
  role?: string;
  buttons?: string[];
  action?: string;
  bundleId?: string;
}> {
  const args = ['alert', action];
  if (options.bundleId) {
    args.push('--bundle-id', assertMacOsBundleId(options.bundleId));
  }
  if (options.surface) {
    args.push('--surface', options.surface);
  }
  return await runMacOsHelper(args);
}

export async function runMacOsSnapshotAction(surface: Exclude<SessionSurface, 'app'>): Promise<{
  surface: Exclude<SessionSurface, 'app'>;
  nodes: MacOsSnapshotNode[];
  truncated: boolean;
  backend: 'macos-helper';
}> {
  return await runMacOsHelper(['snapshot', '--surface', surface]);
}
