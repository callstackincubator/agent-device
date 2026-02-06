import { promises as fs } from 'node:fs';
import { runCmd, whichCmd } from '../../utils/exec.ts';
import { withRetry } from '../../utils/retry.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RawSnapshotNode, Rect, SnapshotOptions } from '../../utils/snapshot.ts';
import { waitForAndroidBoot } from './devices.ts';

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
  filter: 'launchable' | 'user-installed' | 'all' = 'launchable',
): Promise<string[]> {
  if (filter === 'launchable') {
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
    if (result.exitCode === 0 && result.stdout.trim().length > 0) {
      const packages = new Set<string>();
      for (const line of result.stdout.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const firstToken = trimmed.split(/\s+/)[0];
        const pkg = firstToken.includes('/') ? firstToken.split('/')[0] : firstToken;
        if (pkg) packages.add(pkg);
      }
      if (packages.size > 0) {
        return Array.from(packages);
      }
    }
    // fallback: list all if query-activities not available
  }

  const args =
    filter === 'user-installed'
      ? ['shell', 'pm', 'list', 'packages', '-3']
      : ['shell', 'pm', 'list', 'packages'];
  const result = await runCmd('adb', adbArgs(device, args));
  return result.stdout
    .split('\n')
    .map((line: string) => line.replace('package:', '').trim())
    .filter(Boolean);
}

export async function listAndroidAppsMetadata(
  device: DeviceInfo,
  filter: 'launchable' | 'user-installed' | 'all' = 'launchable',
): Promise<Array<{ package: string; launchable: boolean }>> {
  const apps = await listAndroidApps(device, filter);
  const launchable = filter === 'launchable'
    ? new Set(apps)
    : new Set(await listAndroidApps(device, 'launchable'));
  return apps.map((pkg) => ({ package: pkg, launchable: launchable.has(pkg) }));
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

export async function pressAndroid(device: DeviceInfo, x: number, y: number): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'tap', String(x), String(y)]));
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
  await focusAndroid(device, x, y);
  await typeAndroid(device, text);
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
  await runCmd(
    'adb',
    adbArgs(device, ['shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']),
  );
  const result = await runCmd('adb', adbArgs(device, ['shell', 'cat', '/sdcard/window_dump.xml']));
  return result.stdout;
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
  return false;
}

function parseSettingState(state: string): boolean {
  const normalized = state.toLowerCase();
  if (normalized === 'on' || normalized === 'true' || normalized === '1') return true;
  if (normalized === 'off' || normalized === 'false' || normalized === '0') return false;
  throw new AppError('INVALID_ARGS', `Invalid setting state: ${state}`);
}

function findBounds(xml: string, query: string): { x: number; y: number } | null {
  const q = query.toLowerCase();
  const nodeRegex = /<node[^>]+>/g;
  let match = nodeRegex.exec(xml);
  while (match) {
    const node = match[0];
    const textMatch = /text="([^"]*)"/.exec(node);
    const descMatch = /content-desc="([^"]*)"/.exec(node);
    const textVal = (textMatch?.[1] ?? '').toLowerCase();
    const descVal = (descMatch?.[1] ?? '').toLowerCase();
    if (textVal.includes(q) || descVal.includes(q)) {
      const boundsMatch = /bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/.exec(node);
      if (boundsMatch) {
        const x1 = Number(boundsMatch[1]);
        const y1 = Number(boundsMatch[2]);
        const x2 = Number(boundsMatch[3]);
        const y2 = Number(boundsMatch[4]);
        return { x: Math.floor((x1 + x2) / 2), y: Math.floor((y1 + y2) / 2) };
      }
      return { x: 0, y: 0 };
    }
    match = nodeRegex.exec(xml);
  }
  return null;
}

function parseUiHierarchy(
  xml: string,
  maxNodes: number,
  options: SnapshotOptions,
): { nodes: RawSnapshotNode[]; truncated?: boolean } {
  const tree = parseUiHierarchyTree(xml);
  const nodes: RawSnapshotNode[] = [];
  let truncated = false;
  const maxDepth = options.depth ?? Number.POSITIVE_INFINITY;
  const scopedRoot = options.scope ? findScopeNode(tree, options.scope) : null;
  const roots = scopedRoot ? [scopedRoot] : tree.children;

  const interactiveDescendantMemo = new Map<AndroidNode, boolean>();
  const hasInteractiveDescendant = (node: AndroidNode): boolean => {
    const cached = interactiveDescendantMemo.get(node);
    if (cached !== undefined) return cached;
    for (const child of node.children) {
      if (child.hittable || hasInteractiveDescendant(child)) {
        interactiveDescendantMemo.set(node, true);
        return true;
      }
    }
    interactiveDescendantMemo.set(node, false);
    return false;
  };

  const walk = (
    node: AndroidNode,
    depth: number,
    parentIndex?: number,
    ancestorHittable: boolean = false,
    ancestorCollection: boolean = false,
  ) => {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) return;

    const include = options.raw
      ? true
      : shouldIncludeAndroidNode(
          node,
          options,
          ancestorHittable,
          hasInteractiveDescendant(node),
          ancestorCollection,
        );
    let currentIndex = parentIndex;
    if (include) {
      currentIndex = nodes.length;
      nodes.push({
        index: currentIndex,
        type: node.type ?? undefined,
        label: node.label ?? undefined,
        value: node.value ?? undefined,
        identifier: node.identifier ?? undefined,
        rect: node.rect,
        enabled: node.enabled,
        hittable: node.hittable,
        depth,
        parentIndex,
      });
    }
    const nextAncestorHittable = ancestorHittable || Boolean(node.hittable);
    const nextAncestorCollection = ancestorCollection || isCollectionContainerType(node.type);
    for (const child of node.children) {
      walk(child, depth + 1, currentIndex, nextAncestorHittable, nextAncestorCollection);
      if (truncated) return;
    }
  };

  for (const root of roots) {
    walk(root, 0, undefined, false, false);
    if (truncated) break;
  }

  return truncated ? { nodes, truncated } : { nodes };
}

function readNodeAttributes(node: string): {
  text: string | null;
  desc: string | null;
  resourceId: string | null;
  className: string | null;
  bounds: string | null;
  clickable?: boolean;
  enabled?: boolean;
  focusable?: boolean;
} {
  const getAttr = (name: string): string | null => {
    const regex = new RegExp(`${name}="([^"]*)"`);
    const match = regex.exec(node);
    return match ? match[1] : null;
  };
  const boolAttr = (name: string): boolean | undefined => {
    const raw = getAttr(name);
    if (raw === null) return undefined;
    return raw === 'true';
  };
  return {
    text: getAttr('text'),
    desc: getAttr('content-desc'),
    resourceId: getAttr('resource-id'),
    className: getAttr('class'),
    bounds: getAttr('bounds'),
    clickable: boolAttr('clickable'),
    enabled: boolAttr('enabled'),
    focusable: boolAttr('focusable'),
  };
}

function parseBounds(bounds: string | null): Rect | undefined {
  if (!bounds) return undefined;
  const match = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(bounds);
  if (!match) return undefined;
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

type AndroidNode = {
  type: string | null;
  label: string | null;
  value: string | null;
  identifier: string | null;
  rect?: Rect;
  enabled?: boolean;
  hittable?: boolean;
  depth: number;
  parentIndex?: number;
  children: AndroidNode[];
};

function parseUiHierarchyTree(xml: string): AndroidNode {
  const root: AndroidNode = {
    type: null,
    label: null,
    value: null,
    identifier: null,
    depth: -1,
    children: [],
  };
  const stack: AndroidNode[] = [root];
  const tokenRegex = /<node\b[^>]*>|<\/node>/g;
  let match = tokenRegex.exec(xml);
  while (match) {
    const token = match[0];
    if (token.startsWith('</node')) {
      if (stack.length > 1) stack.pop();
      match = tokenRegex.exec(xml);
      continue;
    }
    const attrs = readNodeAttributes(token);
    const rect = parseBounds(attrs.bounds);
    const parent = stack[stack.length - 1];
    const node: AndroidNode = {
      type: attrs.className,
      label: attrs.text || attrs.desc,
      value: attrs.text,
      identifier: attrs.resourceId,
      rect,
      enabled: attrs.enabled,
      hittable: attrs.clickable ?? attrs.focusable,
      depth: parent.depth + 1,
      parentIndex: undefined,
      children: [],
    };
    parent.children.push(node);
    if (!token.endsWith('/>')) {
      stack.push(node);
    }
    match = tokenRegex.exec(xml);
  }
  return root;
}

function shouldIncludeAndroidNode(
  node: AndroidNode,
  options: SnapshotOptions,
  ancestorHittable: boolean,
  descendantHittable: boolean,
  ancestorCollection: boolean,
): boolean {
  const type = normalizeAndroidType(node.type);
  const hasText = Boolean(node.label && node.label.trim().length > 0);
  const hasId = Boolean(node.identifier && node.identifier.trim().length > 0);
  const hasMeaningfulText = hasText && !isGenericAndroidId(node.label ?? '');
  const hasMeaningfulId = hasId && !isGenericAndroidId(node.identifier ?? '');
  const isStructural = isStructuralAndroidType(type);
  const isVisual = type === 'imageview' || type === 'imagebutton';
  if (options.interactiveOnly) {
    if (node.hittable) return true;
    // Keep text proxies for tappable rows while dropping structural noise.
    const proxyCandidate = hasMeaningfulText || hasMeaningfulId;
    if (!proxyCandidate) return false;
    if (isVisual) return false;
    if (isStructural && !ancestorCollection) return false;
    return ancestorHittable || descendantHittable || ancestorCollection;
  }
  if (options.compact) {
    return hasMeaningfulText || hasMeaningfulId || Boolean(node.hittable);
  }
  if (isStructural || isVisual) {
    if (node.hittable) return true;
    if (hasMeaningfulText) return true;
    if (hasMeaningfulId && descendantHittable) return true;
    return descendantHittable;
  }
  return true;
}

function isCollectionContainerType(type: string | null): boolean {
  if (!type) return false;
  const normalized = normalizeAndroidType(type);
  return (
    normalized.includes('recyclerview') ||
    normalized.includes('listview') ||
    normalized.includes('gridview')
  );
}

function normalizeAndroidType(type: string | null): string {
  if (!type) return '';
  return type.toLowerCase();
}

function isStructuralAndroidType(type: string): boolean {
  const short = type.split('.').pop() ?? type;
  return (
    short.includes('layout') ||
    short === 'viewgroup' ||
    short === 'view'
  );
}

function isGenericAndroidId(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  return /^[\w.]+:id\/[\w.-]+$/i.test(trimmed);
}

function findScopeNode(root: AndroidNode, scope: string): AndroidNode | null {
  const query = scope.toLowerCase();
  const stack: AndroidNode[] = [...root.children];
  while (stack.length > 0) {
    const node = stack.shift() as AndroidNode;
    const label = node.label?.toLowerCase() ?? '';
    const value = node.value?.toLowerCase() ?? '';
    const identifier = node.identifier?.toLowerCase() ?? '';
    if (label.includes(query) || value.includes(query) || identifier.includes(query)) {
      return node;
    }
    stack.push(...node.children);
  }
  return null;
}
