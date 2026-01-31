import { promises as fs } from 'node:fs';
import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { RawSnapshotNode, Rect, SnapshotOptions } from '../../utils/snapshot.ts';

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

export async function openAndroidApp(device: DeviceInfo, app: string): Promise<void> {
  const resolved = await resolveAndroidApp(device, app);
  if (resolved.type === 'intent') {
    await runCmd('adb', adbArgs(device, ['shell', 'am', 'start', '-a', resolved.value]));
    return;
  }
  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'monkey',
      '-p',
      resolved.value,
      '-c',
      'android.intent.category.LAUNCHER',
      '1',
    ]),
  );
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
  await runCmd(
    'adb',
    adbArgs(device, ['shell', 'uiautomator', 'dump', '/sdcard/window_dump.xml']),
  );
  const result = await runCmd('adb', adbArgs(device, ['shell', 'cat', '/sdcard/window_dump.xml']));
  return result.stdout;
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

  const walk = (node: AndroidNode, depth: number) => {
    if (nodes.length >= maxNodes) {
      truncated = true;
      return;
    }
    if (depth > maxDepth) return;

    const include = options.raw ? true : shouldIncludeAndroidNode(node, options);
    if (include) {
      nodes.push({
        index: nodes.length,
        type: node.type ?? undefined,
        label: node.label ?? undefined,
        value: node.value ?? undefined,
        identifier: node.identifier ?? undefined,
        rect: node.rect,
        enabled: node.enabled,
        hittable: node.hittable,
        depth,
        parentIndex: node.parentIndex,
      });
    }
    for (const child of node.children) {
      walk(child, depth + 1);
      if (truncated) return;
    }
  };

  for (const root of roots) {
    walk(root, 0);
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

function shouldIncludeAndroidNode(node: AndroidNode, options: SnapshotOptions): boolean {
  if (options.interactiveOnly) {
    return Boolean(node.hittable);
  }
  if (options.compact) {
    const hasText = Boolean(node.label && node.label.trim().length > 0);
    const hasId = Boolean(node.identifier && node.identifier.trim().length > 0);
    return hasText || hasId || Boolean(node.hittable);
  }
  return true;
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
