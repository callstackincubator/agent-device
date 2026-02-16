import { promises as fs } from 'node:fs';
import { runCmd, whichCmd } from '../../utils/exec.ts';
import { withRetry } from '../../utils/retry.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RawSnapshotNode, SnapshotOptions } from '../../utils/snapshot.ts';
import { isDeepLinkTarget } from '../../core/open-target.ts';
import { waitForAndroidBoot } from './devices.ts';
import { findBounds, parseBounds, parseUiHierarchy, readNodeAttributes } from './ui-hierarchy.ts';

const ALIASES: Record<string, { type: 'intent' | 'package'; value: string }> = {
  settings: { type: 'intent', value: 'android.settings.SETTINGS' },
};

function adbArgs(device: DeviceInfo, args: string[]): string[] {
  return ['-s', device.id, ...args];
}

export async function resolveAndroidApp(
  device: DeviceInfo,
  app: string,
): Promise<{ type: 'intent' | 'package'; value: string }> {
  const trimmed = app.trim();
  if (trimmed.includes('.')) return { type: 'package', value: trimmed };

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
    throw new AppError('INVALID_ARGS', `Multiple packages matched "${app}"`, { matches });
  }

  throw new AppError('APP_NOT_INSTALLED', `No package found matching "${app}"`);
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
      'android.intent.category.LAUNCHER',
    ]),
    { allowFailure: true },
  );
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return new Set<string>();
  }
  const packages = new Set<string>();
  for (const line of result.stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const firstToken = trimmed.split(/\s+/)[0];
    const pkg = firstToken.includes('/') ? firstToken.split('/')[0] : firstToken;
    if (pkg) packages.add(pkg);
  }
  return packages;
}

async function listAndroidUserInstalledPackages(device: DeviceInfo): Promise<string[]> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'pm', 'list', 'packages', '-3']));
  return result.stdout
    .split('\n')
    .map((line: string) => line.replace('package:', '').trim())
    .filter(Boolean);
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

export async function getAndroidAppState(
  device: DeviceInfo,
): Promise<{ package?: string; activity?: string }> {
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
): Promise<{ package?: string; activity?: string } | null> {
  for (const args of commands) {
    const result = await runCmd('adb', adbArgs(device, args), { allowFailure: true });
    const text = result.stdout ?? '';
    const parsed = parseAndroidFocus(text);
    if (parsed) return parsed;
  }
  return null;
}

function parseAndroidFocus(text: string): { package?: string; activity?: string } | null {
  const patterns = [
    /mCurrentFocus=Window\{[^}]*\s([\w.]+)\/([\w.$]+)/,
    /mFocusedApp=AppWindowToken\{[^}]*\s([\w.]+)\/([\w.$]+)/,
    /mResumedActivity:.*?\s([\w.]+)\/([\w.$]+)/,
    /ResumedActivity:.*?\s([\w.]+)\/([\w.$]+)/,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) {
      return { package: match[1], activity: match[2] };
    }
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
      throw new AppError('INVALID_ARGS', 'Activity override is not supported when opening a deep link URL');
    }
    await runCmd('adb', adbArgs(device, [
      'shell',
      'am',
      'start',
      '-W',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      deepLinkTarget,
    ]));
    return;
  }
  const resolved = await resolveAndroidApp(device, app);
  if (resolved.type === 'intent') {
    if (activity) {
      throw new AppError('INVALID_ARGS', 'Activity override requires a package name, not an intent');
    }
    await runCmd('adb', adbArgs(device, ['shell', 'am', 'start', '-a', resolved.value]));
    return;
  }
  if (activity) {
    const component = activity.includes('/')
      ? activity
      : `${resolved.value}/${activity.startsWith('.') ? activity : `.${activity}`}`;
    await runCmd(
      'adb',
      adbArgs(device, [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.DEFAULT',
        '-c',
        'android.intent.category.LAUNCHER',
        '-n',
        component,
      ]),
    );
    return;
  }
  try {
    await runCmd(
      'adb',
      adbArgs(device, [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.DEFAULT',
        '-c',
        'android.intent.category.LAUNCHER',
        '-p',
        resolved.value,
      ]),
    );
    return;
  } catch (initialError) {
    const component = await resolveAndroidLaunchComponent(device, resolved.value);
    if (!component) throw initialError;
    await runCmd(
      'adb',
      adbArgs(device, [
        'shell',
        'am',
        'start',
        '-a',
        'android.intent.action.MAIN',
        '-c',
        'android.intent.category.DEFAULT',
        '-c',
        'android.intent.category.LAUNCHER',
        '-n',
        component,
      ]),
    );
  }
}

async function resolveAndroidLaunchComponent(
  device: DeviceInfo,
  packageName: string,
): Promise<string | null> {
  const result = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'cmd', 'package', 'resolve-activity', '--brief', packageName]),
    { allowFailure: true },
  );
  if (result.exitCode !== 0) return null;
  return parseAndroidLaunchComponent(result.stdout);
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

export async function uninstallAndroidApp(
  device: DeviceInfo,
  app: string,
): Promise<{ package: string }> {
  const resolved = await resolveAndroidApp(device, app);
  if (resolved.type === 'intent') {
    throw new AppError('INVALID_ARGS', 'reinstall requires a package name, not an intent');
  }
  const result = await runCmd('adb', adbArgs(device, ['uninstall', resolved.value]), { allowFailure: true });
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

export async function installAndroidApp(device: DeviceInfo, appPath: string): Promise<void> {
  await runCmd('adb', adbArgs(device, ['install', appPath]));
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
  await installAndroidApp(device, appPath);
  return { package: pkg };
}

export async function pressAndroid(device: DeviceInfo, x: number, y: number): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'tap', String(x), String(y)]));
}

export async function swipeAndroid(
  device: DeviceInfo,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 250,
): Promise<void> {
  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(x1),
      String(y1),
      String(x2),
      String(y2),
      String(durationMs),
    ]),
  );
}

export async function backAndroid(device: DeviceInfo): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '4']));
}

export async function homeAndroid(device: DeviceInfo): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '3']));
}

export async function appSwitcherAndroid(device: DeviceInfo): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '187']));
}

export async function longPressAndroid(
  device: DeviceInfo,
  x: number,
  y: number,
  durationMs = 800,
): Promise<void> {
  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(x),
      String(y),
      String(x),
      String(y),
      String(durationMs),
    ]),
  );
}

export async function typeAndroid(device: DeviceInfo, text: string): Promise<void> {
  const encoded = text.replace(/ /g, '%s');
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'text', encoded]));
}

export async function focusAndroid(device: DeviceInfo, x: number, y: number): Promise<void> {
  await pressAndroid(device, x, y);
}

export async function fillAndroid(
  device: DeviceInfo,
  x: number,
  y: number,
  text: string,
): Promise<void> {
  const attempts = [
    { clearPadding: 12, minClear: 8, maxClear: 48, chunkSize: 4, delayMs: 0 },
    { clearPadding: 24, minClear: 16, maxClear: 96, chunkSize: 1, delayMs: 15 },
  ] as const;

  await focusAndroid(device, x, y);
  let lastActual: string | null = null;

  for (const attempt of attempts) {
    const clearCount = clampCount(
      text.length + attempt.clearPadding,
      attempt.minClear,
      attempt.maxClear,
    );
    await clearFocusedText(device, clearCount);
    await typeAndroidChunked(device, text, attempt.chunkSize, attempt.delayMs);
    lastActual = await readInputValueAtPoint(device, x, y);
    if (lastActual === text) return;
  }

  throw new AppError('COMMAND_FAILED', 'Android fill verification failed', {
    expected: text,
    actual: lastActual ?? null,
  });
}

export async function scrollAndroid(
  device: DeviceInfo,
  direction: string,
  amount = 0.6,
): Promise<void> {
  const size = await getAndroidScreenSize(device);
  const { width, height } = size;
  const distanceX = Math.floor(width * amount);
  const distanceY = Math.floor(height * amount);

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  let x1 = centerX;
  let y1 = centerY;
  let x2 = centerX;
  let y2 = centerY;

  switch (direction) {
    case 'up':
      // Content moves up -> swipe down.
      y1 = centerY - Math.floor(distanceY / 2);
      y2 = centerY + Math.floor(distanceY / 2);
      break;
    case 'down':
      // Content moves down -> swipe up.
      y1 = centerY + Math.floor(distanceY / 2);
      y2 = centerY - Math.floor(distanceY / 2);
      break;
    case 'left':
      // Content moves left -> swipe right.
      x1 = centerX - Math.floor(distanceX / 2);
      x2 = centerX + Math.floor(distanceX / 2);
      break;
    case 'right':
      // Content moves right -> swipe left.
      x1 = centerX + Math.floor(distanceX / 2);
      x2 = centerX - Math.floor(distanceX / 2);
      break;
    default:
      throw new AppError('INVALID_ARGS', `Unknown direction: ${direction}`);
  }

  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(x1),
      String(y1),
      String(x2),
      String(y2),
      '300',
    ]),
  );
}

export async function scrollIntoViewAndroid(device: DeviceInfo, text: string): Promise<void> {
  const maxAttempts = 8;
  for (let i = 0; i < maxAttempts; i += 1) {
    let xml = '';
    try {
      xml = await dumpUiHierarchy(device);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError('UNSUPPORTED_OPERATION', `uiautomator dump failed: ${message}`);
    }
    if (findBounds(xml, text)) return;
    await scrollAndroid(device, 'down', 0.5);
  }
  throw new AppError(
    'COMMAND_FAILED',
    `Could not find element containing "${text}" after scrolling`,
  );
}

export async function screenshotAndroid(device: DeviceInfo, outPath: string): Promise<void> {
  const result = await runCmd('adb', adbArgs(device, ['exec-out', 'screencap', '-p']), {
    binaryStdout: true,
  });
  if (!result.stdoutBuffer) {
    throw new AppError('COMMAND_FAILED', 'Failed to capture screenshot');
  }
  await fs.writeFile(outPath, result.stdoutBuffer);
}

export async function setAndroidSetting(
  device: DeviceInfo,
  setting: string,
  state: string,
): Promise<void> {
  const normalized = setting.toLowerCase();
  const enabled = parseSettingState(state);
  switch (normalized) {
    case 'wifi': {
      await runCmd('adb', adbArgs(device, ['shell', 'svc', 'wifi', enabled ? 'enable' : 'disable']));
      return;
    }
    case 'airplane': {
      const flag = enabled ? '1' : '0';
      const bool = enabled ? 'true' : 'false';
      await runCmd('adb', adbArgs(device, ['shell', 'settings', 'put', 'global', 'airplane_mode_on', flag]));
      await runCmd('adb', adbArgs(device, ['shell', 'am', 'broadcast', '-a', 'android.intent.action.AIRPLANE_MODE', '--ez', 'state', bool]));
      return;
    }
    case 'location': {
      const mode = enabled ? '3' : '0';
      await runCmd('adb', adbArgs(device, ['shell', 'settings', 'put', 'secure', 'location_mode', mode]));
      return;
    }
    default:
      throw new AppError('INVALID_ARGS', `Unsupported setting: ${setting}`);
  }
}

export async function snapshotAndroid(
  device: DeviceInfo,
  options: SnapshotOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
}> {
  const xml = await dumpUiHierarchy(device);
  return parseUiHierarchy(xml, 800, options);
}

export async function ensureAdb(): Promise<void> {
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) throw new AppError('TOOL_MISSING', 'adb not found in PATH');
}

async function getAndroidScreenSize(
  device: DeviceInfo,
): Promise<{ width: number; height: number }> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'wm', 'size']));
  const match = result.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!match) throw new AppError('COMMAND_FAILED', 'Unable to read screen size');
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function dumpUiHierarchy(device: DeviceInfo): Promise<string> {
  return withRetry(() => dumpUiHierarchyOnce(device), {
    shouldRetry: isRetryableAdbError,
  });
}

async function dumpUiHierarchyOnce(device: DeviceInfo): Promise<string> {
  // Preferred: stream XML directly to stdout, avoiding file I/O race conditions.
  const streamed = await runCmd(
    'adb',
    adbArgs(device, ['exec-out', 'uiautomator', 'dump', '/dev/tty']),
    { allowFailure: true },
  );
  if (streamed.exitCode === 0) {
    const fromStream = extractUiDumpXml(streamed.stdout, streamed.stderr);
    if (fromStream) return fromStream;
  }

  // Fallback: dump to file and read back.
  // If `cat` fails with "no such file", the outer withRetry (via isRetryableAdbError) handles it.
  const dumpPath = '/sdcard/window_dump.xml';
  const dumpResult = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'uiautomator', 'dump', dumpPath]),
  );
  const actualPath = resolveDumpPath(dumpPath, dumpResult.stdout, dumpResult.stderr);

  const result = await runCmd('adb', adbArgs(device, ['shell', 'cat', actualPath]));
  const xml = extractUiDumpXml(result.stdout, result.stderr);
  if (!xml) {
    throw new AppError('COMMAND_FAILED', 'uiautomator dump did not return XML', {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return xml;
}

function resolveDumpPath(defaultPath: string, stdout: string, stderr: string): string {
  const text = `${stdout}\n${stderr}`;
  const match = /dumped to:\s*(\S+)/i.exec(text);
  return match?.[1] ?? defaultPath;
}

function extractUiDumpXml(stdout: string, stderr: string): string | null {
  const text = `${stdout}\n${stderr}`;
  const start = text.indexOf('<?xml');
  const hierarchyStart = start >= 0 ? start : text.indexOf('<hierarchy');
  if (hierarchyStart < 0) return null;
  const end = text.lastIndexOf('</hierarchy>');
  if (end < 0 || end < hierarchyStart) return null;
  const xml = text.slice(hierarchyStart, end + '</hierarchy>'.length).trim();
  return xml.length > 0 ? xml : null;
}

function isRetryableAdbError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  if (err.code !== 'COMMAND_FAILED') return false;
  const stderr = `${(err.details as any)?.stderr ?? ''}`.toLowerCase();
  if (stderr.includes('device offline')) return true;
  if (stderr.includes('device not found')) return true;
  if (stderr.includes('transport error')) return true;
  if (stderr.includes('connection reset')) return true;
  if (stderr.includes('broken pipe')) return true;
  if (stderr.includes('timed out')) return true;
  if (stderr.includes('no such file or directory')) return true;
  return false;
}

function parseSettingState(state: string): boolean {
  const normalized = state.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  throw new AppError('INVALID_ARGS', `Invalid setting state: ${state}`);
}

async function typeAndroidChunked(
  device: DeviceInfo,
  text: string,
  chunkSize: number,
  delayMs: number,
): Promise<void> {
  const size = Math.max(1, Math.floor(chunkSize));
  for (let i = 0; i < text.length; i += size) {
    const chunk = text.slice(i, i + size);
    await typeAndroid(device, chunk);
    if (delayMs > 0 && i + size < text.length) {
      await sleep(delayMs);
    }
  }
}

async function clearFocusedText(device: DeviceInfo, count: number): Promise<void> {
  const deletes = Math.max(0, count);
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']), {
    allowFailure: true,
  });
  const batchSize = 24;
  for (let i = 0; i < deletes; i += batchSize) {
    const size = Math.min(batchSize, deletes - i);
    await runCmd(
      'adb',
      adbArgs(device, ['shell', 'input', 'keyevent', ...Array(size).fill('KEYCODE_DEL')]),
      {
        allowFailure: true,
      },
    );
  }
}

async function readInputValueAtPoint(
  device: DeviceInfo,
  x: number,
  y: number,
): Promise<string | null> {
  const xml = await dumpUiHierarchy(device);
  const nodeRegex = /<node\b[^>]*>/g;
  let match: RegExpExecArray | null;
  let focusedEdit: { text: string; area: number } | null = null;
  let editAtPoint: { text: string; area: number } | null = null;
  let anyAtPoint: { text: string; area: number } | null = null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const node = match[0];
    const attrs = readNodeAttributes(node);
    const rect = parseBounds(attrs.bounds);
    if (!rect) continue;
    const className = attrs.className ?? '';
    const text = decodeXmlEntities(attrs.text ?? '');
    const focused = attrs.focused ?? false;
    if (!text) continue;
    const area = Math.max(1, rect.width * rect.height);
    const containsPoint =
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height;

    if (focused && isEditTextClass(className)) {
      if (!focusedEdit || area <= focusedEdit.area) {
        focusedEdit = { text, area };
      }
      continue;
    }
    if (containsPoint && isEditTextClass(className)) {
      if (!editAtPoint || area <= editAtPoint.area) {
        editAtPoint = { text, area };
      }
      continue;
    }
    if (containsPoint) {
      if (!anyAtPoint || area <= anyAtPoint.area) {
        anyAtPoint = { text, area };
      }
    }
  }

  return focusedEdit?.text ?? editAtPoint?.text ?? anyAtPoint?.text ?? null;
}

function isEditTextClass(className: string): boolean {
  const lower = className.toLowerCase();
  return lower.includes('edittext') || lower.includes('textfield');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function clampCount(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
