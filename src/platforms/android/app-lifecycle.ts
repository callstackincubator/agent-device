import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveFileOverridePath, runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import { waitForAndroidBoot } from './devices.ts';
import { adbArgs } from './adb.ts';
import { classifyAndroidAppTarget } from './open-target.ts';
import { prepareAndroidInstallArtifact } from './install-artifact.ts';
import {
  parseAndroidForegroundApp,
  parseAndroidLaunchablePackages,
  parseAndroidUserInstalledPackages,
  type AndroidForegroundApp,
} from './app-parsers.ts';

export {
  parseAndroidForegroundApp,
  parseAndroidLaunchablePackages,
  parseAndroidUserInstalledPackages,
  type AndroidForegroundApp,
} from './app-parsers.ts';

const ALIASES: Record<string, { type: 'intent' | 'package'; value: string }> = {
  settings: { type: 'intent', value: 'android.settings.SETTINGS' },
};
const ANDROID_LAUNCHER_CATEGORY = 'android.intent.category.LAUNCHER';
const ANDROID_LEANBACK_CATEGORY = 'android.intent.category.LEANBACK_LAUNCHER';
const ANDROID_DEFAULT_CATEGORY = 'android.intent.category.DEFAULT';
const ANDROID_APPS_DISCOVERY_HINT =
  'Run agent-device apps --platform android to discover the installed package name, then retry open with that exact package.';
const ANDROID_AMBIGUOUS_APP_HINT =
  'Run agent-device apps --platform android to see the exact installed package names before retrying open.';

export async function resolveAndroidApp(
  device: DeviceInfo,
  app: string,
): Promise<{ type: 'intent' | 'package'; value: string }> {
  const trimmed = app.trim();
  if (classifyAndroidAppTarget(trimmed) === 'package') return { type: 'package', value: trimmed };

  const alias = ALIASES[trimmed.toLowerCase()];
  if (alias) return alias;

  const result = await runCmd('adb', adbArgs(device, ['shell', 'pm', 'list', 'packages']));
  const packages = result.stdout
    .split('\n')
    .map((line: string) => line.replace('package:', '').trim())
    .filter(Boolean);

  const matches = packages.filter((pkg: string) =>
    pkg.toLowerCase().includes(trimmed.toLowerCase()),
  );
  if (matches.length === 1) {
    return { type: 'package', value: matches[0] };
  }

  if (matches.length > 1) {
    throw new AppError('INVALID_ARGS', `Multiple packages matched "${app}"`, {
      matches,
      hint: ANDROID_AMBIGUOUS_APP_HINT,
    });
  }

  throw new AppError('APP_NOT_INSTALLED', `No package found matching "${app}"`, {
    hint: ANDROID_APPS_DISCOVERY_HINT,
  });
}

export async function listAndroidApps(
  device: DeviceInfo,
  filter: 'user-installed' | 'all' = 'all',
): Promise<Array<{ package: string; name: string }>> {
  const launchable = await listAndroidLaunchablePackages(device);
  const packageIds =
    filter === 'user-installed'
      ? (await listAndroidUserInstalledPackages(device)).filter((pkg) => launchable.has(pkg))
      : Array.from(launchable);
  return packageIds
    .sort((a, b) => a.localeCompare(b))
    .map((pkg) => ({ package: pkg, name: inferAndroidAppName(pkg) }));
}

async function listAndroidLaunchablePackages(device: DeviceInfo): Promise<Set<string>> {
  const packages = new Set<string>();
  for (const category of resolveAndroidLaunchCategories(device, {
    includeFallbackWhenUnknown: true,
  })) {
    const result = await runCmd(
      'adb',
      adbArgs(device, [
        'shell',
        'cmd',
        'package',
        'query-activities',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        category,
      ]),
      { allowFailure: true },
    );
    if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
      continue;
    }
    for (const pkg of parseAndroidLaunchablePackages(result.stdout)) {
      packages.add(pkg);
    }
  }
  return packages;
}

function resolveAndroidLauncherCategory(device: DeviceInfo): string {
  return resolveAndroidLaunchCategories(device)[0] ?? ANDROID_LAUNCHER_CATEGORY;
}

function resolveAndroidLaunchCategories(
  device: DeviceInfo,
  options: { includeFallbackWhenUnknown?: boolean } = {},
): string[] {
  if (device.target === 'tv') {
    return [ANDROID_LEANBACK_CATEGORY];
  }
  if (device.target === 'mobile') {
    return [ANDROID_LAUNCHER_CATEGORY];
  }
  if (options.includeFallbackWhenUnknown) {
    return [ANDROID_LAUNCHER_CATEGORY, ANDROID_LEANBACK_CATEGORY];
  }
  return [ANDROID_LAUNCHER_CATEGORY];
}

async function listAndroidUserInstalledPackages(device: DeviceInfo): Promise<string[]> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'pm', 'list', 'packages', '-3']));
  return parseAndroidUserInstalledPackages(result.stdout);
}

export function inferAndroidAppName(packageName: string): string {
  const ignoredTokens = new Set([
    'com',
    'android',
    'google',
    'app',
    'apps',
    'service',
    'services',
    'mobile',
    'client',
  ]);
  const tokens = packageName
    .split('.')
    .flatMap((segment) => segment.split(/[_-]+/))
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);
  // Fallback to last token if every token is ignored (e.g. "com.android.app.services" → "Services").
  let chosen = tokens[tokens.length - 1] ?? packageName;
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (!ignoredTokens.has(token)) {
      chosen = token;
      break;
    }
  }
  return chosen
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export async function getAndroidAppState(device: DeviceInfo): Promise<AndroidForegroundApp> {
  const windowFocus = await readAndroidFocus(device, [
    ['shell', 'dumpsys', 'window', 'windows'],
    ['shell', 'dumpsys', 'window'],
  ]);
  if (windowFocus) return windowFocus;

  const activityFocus = await readAndroidFocus(device, [
    ['shell', 'dumpsys', 'activity', 'activities'],
    ['shell', 'dumpsys', 'activity'],
  ]);
  if (activityFocus) return activityFocus;
  return {};
}

async function readAndroidFocus(
  device: DeviceInfo,
  commands: string[][],
): Promise<AndroidForegroundApp | null> {
  for (const args of commands) {
    const result = await runCmd('adb', adbArgs(device, args), { allowFailure: true });
    const text = result.stdout ?? '';
    const parsed = parseAndroidForegroundApp(text);
    if (parsed) return parsed;
  }
  return null;
}

export async function openAndroidApp(
  device: DeviceInfo,
  app: string,
  activity?: string,
): Promise<void> {
  if (!device.booted) {
    await waitForAndroidBoot(device.id);
  }
  const deepLinkTarget = app.trim();
  if (isDeepLinkTarget(deepLinkTarget)) {
    if (activity) {
      throw new AppError(
        'INVALID_ARGS',
        'Activity override is not supported when opening a deep link URL',
      );
    }
    await runCmd(
      'adb',
      adbArgs(device, [
        'shell',
        'am',
        'start',
        '-W',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        deepLinkTarget,
      ]),
    );
    return;
  }
  const resolved = await resolveAndroidApp(device, app);
  const launchCategory = resolveAndroidLauncherCategory(device);
  if (resolved.type === 'intent') {
    if (activity) {
      throw new AppError(
        'INVALID_ARGS',
        'Activity override requires a package name, not an intent',
      );
    }
    await runCmd('adb', adbArgs(device, ['shell', 'am', 'start', '-W', '-a', resolved.value]));
    return;
  }
  if (activity) {
    const component = activity.includes('/')
      ? activity
      : `${resolved.value}/${activity.startsWith('.') ? activity : `.${activity}`}`;
    try {
      await runCmd(
        'adb',
        adbArgs(device, [
          'shell',
          'am',
          'start',
          '-W',
          '-a',
          'android.intent.action.MAIN',
          '-c',
          ANDROID_DEFAULT_CATEGORY,
          '-c',
          launchCategory,
          '-n',
          component,
        ]),
      );
    } catch (error) {
      await maybeRethrowAndroidMissingPackageError(device, resolved.value, error);
      throw error;
    }
    return;
  }
  const primaryResult = await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      ANDROID_DEFAULT_CATEGORY,
      '-c',
      launchCategory,
      '-p',
      resolved.value,
    ]),
    { allowFailure: true },
  );
  if (primaryResult.exitCode === 0 && !isAmStartError(primaryResult.stdout, primaryResult.stderr)) {
    return;
  }
  const component = await resolveAndroidLaunchComponent(device, resolved.value);
  if (!component) {
    if (!(await isAndroidPackageInstalled(device, resolved.value))) {
      throw buildAndroidPackageNotInstalledError(resolved.value);
    }
    throw new AppError('COMMAND_FAILED', `Failed to launch ${resolved.value}`, {
      stdout: primaryResult.stdout,
      stderr: primaryResult.stderr,
    });
  }
  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.MAIN',
      '-c',
      ANDROID_DEFAULT_CATEGORY,
      '-c',
      launchCategory,
      '-n',
      component,
    ]),
  );
}

function buildAndroidPackageNotInstalledError(packageName: string): AppError {
  return new AppError('APP_NOT_INSTALLED', `No package found matching "${packageName}"`, {
    package: packageName,
    hint: ANDROID_APPS_DISCOVERY_HINT,
  });
}

async function isAndroidPackageInstalled(
  device: DeviceInfo,
  packageName: string,
): Promise<boolean> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'pm', 'path', packageName]), {
    allowFailure: true,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.exitCode === 0 && /\bpackage:/i.test(output)) {
    return true;
  }
  if (looksLikeMissingAndroidPackageOutput(output)) {
    return false;
  }
  return false;
}

async function maybeRethrowAndroidMissingPackageError(
  device: DeviceInfo,
  packageName: string,
  error: unknown,
): Promise<void> {
  const output =
    error instanceof AppError
      ? `${String(error.details?.stdout ?? '')}\n${String(error.details?.stderr ?? '')}`
      : '';
  if (looksLikeMissingAndroidPackageOutput(output)) {
    throw buildAndroidPackageNotInstalledError(packageName);
  }
  if (!(await isAndroidPackageInstalled(device, packageName))) {
    throw buildAndroidPackageNotInstalledError(packageName);
  }
}

function looksLikeMissingAndroidPackageOutput(output: string): boolean {
  return (
    /\bunknown package\b/i.test(output) ||
    /\bpackage .* (?:was|is) not found\b/i.test(output) ||
    /\bpackage .* does not exist\b/i.test(output) ||
    /\bcould not find package\b/i.test(output)
  );
}

async function resolveAndroidLaunchComponent(
  device: DeviceInfo,
  packageName: string,
): Promise<string | null> {
  const categories = Array.from(
    new Set(resolveAndroidLaunchCategories(device, { includeFallbackWhenUnknown: true })),
  );
  for (const category of categories) {
    const result = await runCmd(
      'adb',
      adbArgs(device, [
        'shell',
        'cmd',
        'package',
        'resolve-activity',
        '--brief',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        category,
        packageName,
      ]),
      { allowFailure: true },
    );
    if (result.exitCode !== 0) {
      continue;
    }
    const component = parseAndroidLaunchComponent(result.stdout);
    if (component) return component;
  }
  return null;
}

export function isAmStartError(stdout: string, stderr: string): boolean {
  const output = `${stdout}\n${stderr}`;
  return /Error:.*(?:Activity not started|unable to resolve Intent)/i.test(output);
}

export function parseAndroidLaunchComponent(stdout: string): string | null {
  const lines = stdout
    .split('\n')
    .map((line: string) => line.trim())
    .filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line.includes('/')) continue;
    return line.split(/\s+/)[0];
  }
  return null;
}

export async function openAndroidDevice(device: DeviceInfo): Promise<void> {
  if (!device.booted) {
    await waitForAndroidBoot(device.id);
  }
}

export async function closeAndroidApp(device: DeviceInfo, app: string): Promise<void> {
  const trimmed = app.trim();
  if (trimmed.toLowerCase() === 'settings') {
    await runCmd('adb', adbArgs(device, ['shell', 'am', 'force-stop', 'com.android.settings']));
    return;
  }
  const resolved = await resolveAndroidApp(device, app);
  if (resolved.type === 'intent') {
    throw new AppError('INVALID_ARGS', 'Close requires a package name, not an intent');
  }
  await runCmd('adb', adbArgs(device, ['shell', 'am', 'force-stop', resolved.value]));
}

async function uninstallAndroidApp(device: DeviceInfo, app: string): Promise<{ package: string }> {
  const resolved = await resolveAndroidApp(device, app);
  if (resolved.type === 'intent') {
    throw new AppError('INVALID_ARGS', 'App uninstall requires a package name, not an intent');
  }
  const result = await runCmd('adb', adbArgs(device, ['uninstall', resolved.value]), {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
    if (!output.includes('unknown package') && !output.includes('not installed')) {
      throw new AppError('COMMAND_FAILED', `adb uninstall failed for ${resolved.value}`, {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    }
  }
  return { package: resolved.value };
}

type BundletoolInvocation =
  | { cmd: 'bundletool'; prefixArgs: readonly string[] }
  | { cmd: 'java'; prefixArgs: readonly string[] };

// Module-level cache for bundletool resolution.  Safe for the single-threaded
// Node.js event loop; concurrent async callers may race to populate it but will
// resolve to the same value since the inputs (PATH, env var) are stable per
// process lifetime.
let cachedBundletoolInvocation: { key: string; invocation: BundletoolInvocation } | null = null;

function bundletoolInvocationCacheKey(): string {
  return `${process.env.PATH ?? ''}::${process.env.AGENT_DEVICE_BUNDLETOOL_JAR ?? ''}`;
}

async function resolveBundletoolInvocation(): Promise<BundletoolInvocation> {
  const cacheKey = bundletoolInvocationCacheKey();
  if (cachedBundletoolInvocation?.key === cacheKey) {
    return cachedBundletoolInvocation.invocation;
  }

  if (await whichCmd('bundletool')) {
    const invocation = { cmd: 'bundletool', prefixArgs: [] } as const;
    cachedBundletoolInvocation = { key: cacheKey, invocation };
    return invocation;
  }

  const bundletoolJar = await resolveFileOverridePath(
    process.env.AGENT_DEVICE_BUNDLETOOL_JAR,
    'AGENT_DEVICE_BUNDLETOOL_JAR',
  );
  if (!bundletoolJar) {
    throw new AppError(
      'TOOL_MISSING',
      'bundletool not found in PATH. Install bundletool or set AGENT_DEVICE_BUNDLETOOL_JAR to a bundletool-all.jar path.',
    );
  }
  const invocation = { cmd: 'java', prefixArgs: ['-jar', bundletoolJar] } as const;
  cachedBundletoolInvocation = { key: cacheKey, invocation };
  return invocation;
}

async function runBundletool(args: string[]): Promise<void> {
  const invocation = await resolveBundletoolInvocation();
  await runCmd(invocation.cmd, [...invocation.prefixArgs, ...args]);
}

function isAndroidAppBundlePath(appPath: string): boolean {
  return path.extname(appPath).toLowerCase() === '.aab';
}

function resolveBundletoolBuildMode(): string {
  const mode = process.env.AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE?.trim();
  return mode && mode.length > 0 ? mode : 'universal';
}

async function installAndroidAppBundle(device: DeviceInfo, appPath: string): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-aab-'));
  const apksPath = path.join(tempDir, 'bundle.apks');
  const mode = resolveBundletoolBuildMode();
  try {
    await runBundletool(['build-apks', '--bundle', appPath, '--output', apksPath, '--mode', mode]);
    await runBundletool(['install-apks', '--apks', apksPath, '--device-id', device.id]);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function installAndroidAppFiles(device: DeviceInfo, appPath: string): Promise<void> {
  if (isAndroidAppBundlePath(appPath)) {
    await installAndroidAppBundle(device, appPath);
    return;
  }
  await runCmd('adb', adbArgs(device, ['install', '-r', appPath]));
}

async function listInstalledAndroidPackages(device: DeviceInfo): Promise<Set<string>> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'pm', 'list', 'packages']));
  return new Set(
    result.stdout
      .split('\n')
      .map((line: string) => line.replace('package:', '').trim())
      .filter(Boolean),
  );
}

async function resolveInstalledAndroidPackageName(
  device: DeviceInfo,
  beforePackages: Set<string>,
): Promise<string | undefined> {
  const afterPackages = await listInstalledAndroidPackages(device);
  const installedNow = Array.from(afterPackages).filter((pkg) => !beforePackages.has(pkg));
  if (installedNow.length === 1) return installedNow[0];
  return undefined;
}

export async function installAndroidInstallablePath(
  device: DeviceInfo,
  installablePath: string,
): Promise<void> {
  if (!device.booted) {
    await waitForAndroidBoot(device.id);
  }
  await installAndroidAppFiles(device, installablePath);
}

export async function installAndroidInstallablePathAndResolvePackageName(
  device: DeviceInfo,
  installablePath: string,
  packageNameHint?: string,
): Promise<string | undefined> {
  const beforePackages = packageNameHint ? undefined : await listInstalledAndroidPackages(device);
  await installAndroidInstallablePath(device, installablePath);
  return (
    packageNameHint ??
    (beforePackages ? await resolveInstalledAndroidPackageName(device, beforePackages) : undefined)
  );
}

export async function installAndroidApp(
  device: DeviceInfo,
  appPath: string,
): Promise<{
  archivePath?: string;
  installablePath: string;
  packageName?: string;
  appName?: string;
  launchTarget?: string;
}> {
  if (!device.booted) {
    await waitForAndroidBoot(device.id);
  }
  const prepared = await prepareAndroidInstallArtifact({ kind: 'path', path: appPath });
  try {
    const packageName = await installAndroidInstallablePathAndResolvePackageName(
      device,
      prepared.installablePath,
      prepared.packageName,
    );
    const appName = packageName ? inferAndroidAppName(packageName) : undefined;
    return {
      archivePath: prepared.archivePath,
      installablePath: prepared.installablePath,
      packageName,
      appName,
      launchTarget: packageName,
    };
  } finally {
    await prepared.cleanup();
  }
}

export async function reinstallAndroidApp(
  device: DeviceInfo,
  app: string,
  appPath: string,
): Promise<{ package: string }> {
  if (!device.booted) {
    await waitForAndroidBoot(device.id);
  }
  const { package: pkg } = await uninstallAndroidApp(device, app);
  const prepared = await prepareAndroidInstallArtifact(
    { kind: 'path', path: appPath },
    { resolveIdentity: false },
  );
  try {
    await installAndroidInstallablePath(device, prepared.installablePath);
    return { package: pkg };
  } finally {
    await prepared.cleanup();
  }
}
