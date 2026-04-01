import { runCmd } from '../../utils/exec.ts';
import { withRetry } from '../../utils/retry.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { attachRefs, type RawSnapshotNode, type SnapshotOptions } from '../../utils/snapshot.ts';
import { isScrollableType } from '../../utils/scrollable.ts';
import { buildMobileSnapshotPresentation } from '../../utils/mobile-snapshot-semantics.ts';
import {
  buildUiHierarchySnapshot,
  parseUiHierarchy,
  parseUiHierarchyTree,
  type AndroidSnapshotAnalysis,
} from './ui-hierarchy.ts';
import { adbArgs } from './adb.ts';
import { annotateAndroidScrollableContentHints } from './scroll-hints.ts';

export async function snapshotAndroid(
  device: DeviceInfo,
  options: SnapshotOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
}> {
  const xml = await dumpUiHierarchy(device);
  if (!options.interactiveOnly) {
    const parsed = parseUiHierarchy(xml, 800, options);
    await annotateScrollableContentHintsIfNeeded(device, parsed.nodes);
    return parsed;
  }

  const tree = parseUiHierarchyTree(xml);
  const parsed = buildUiHierarchySnapshot(tree, 800, { ...options, interactiveOnly: false });
  await annotateScrollableContentHintsIfNeeded(device, parsed.nodes);
  applyDerivedHiddenContentHints(parsed.nodes);
  const interactiveParsed = buildUiHierarchySnapshot(tree, 800, options);
  copyHiddenContentHints(parsed.nodes, interactiveParsed.nodes);
  return interactiveParsed;
}

async function annotateScrollableContentHintsIfNeeded(
  device: DeviceInfo,
  nodes: RawSnapshotNode[],
): Promise<void> {
  if (!nodes.some((node) => isScrollableType(node.type))) {
    return;
  }
  const activityTopDump = await dumpActivityTop(device);
  if (activityTopDump) {
    annotateAndroidScrollableContentHints(nodes, activityTopDump);
  }
}

export async function dumpUiHierarchy(device: DeviceInfo): Promise<string> {
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
  const fromStream = extractUiDumpXml(streamed.stdout, streamed.stderr);
  if (fromStream) return fromStream;

  // Fallback: dump to file and read back.
  // If `cat` fails with "no such file", the outer withRetry (via isRetryableAdbError) handles it.
  const dumpPath = '/sdcard/window_dump.xml';
  const dumpResult = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'uiautomator', 'dump', dumpPath]),
    { allowFailure: true },
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

async function dumpActivityTop(device: DeviceInfo): Promise<string | null> {
  try {
    const result = await runCmd('adb', adbArgs(device, ['shell', 'dumpsys', 'activity', 'top']), {
      allowFailure: true,
      timeoutMs: 2_000,
    });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function copyHiddenContentHints(
  sourceNodes: RawSnapshotNode[],
  targetNodes: RawSnapshotNode[],
): void {
  const hintsBySignature = new Map<string, RawSnapshotNode>();
  const hintsByLooseSignature = new Map<string, RawSnapshotNode>();
  for (const node of sourceNodes) {
    if (!node.hiddenContentAbove && !node.hiddenContentBelow) {
      continue;
    }
    const signature = buildHintSignature(node);
    if (signature && !hintsBySignature.has(signature)) {
      hintsBySignature.set(signature, node);
    }
    const looseSignature = buildLooseHintSignature(node);
    if (!looseSignature || hintsByLooseSignature.has(looseSignature)) {
      continue;
    }
    hintsByLooseSignature.set(looseSignature, node);
  }

  for (const node of targetNodes) {
    const signature = buildHintSignature(node);
    const looseSignature = buildLooseHintSignature(node);
    const source =
      (signature ? hintsBySignature.get(signature) : undefined) ??
      (looseSignature ? hintsByLooseSignature.get(looseSignature) : undefined);
    if (!source) {
      continue;
    }
    node.hiddenContentAbove = source.hiddenContentAbove;
    node.hiddenContentBelow = source.hiddenContentBelow;
  }
}

function applyDerivedHiddenContentHints(nodes: RawSnapshotNode[]): void {
  if (
    nodes.length === 0 ||
    nodes.some((node) => node.hiddenContentAbove || node.hiddenContentBelow)
  ) {
    return;
  }
  const presentation = buildMobileSnapshotPresentation(attachRefs(nodes));
  const hintsByIndex = new Map(
    presentation.nodes
      .filter((node) => node.hiddenContentAbove || node.hiddenContentBelow)
      .map((node) => [node.index, node] as const),
  );
  for (const node of nodes) {
    const hint = hintsByIndex.get(node.index);
    if (!hint) {
      continue;
    }
    if (hint.hiddenContentAbove) {
      node.hiddenContentAbove = true;
    }
    if (hint.hiddenContentBelow) {
      node.hiddenContentBelow = true;
    }
  }
}

function buildHintSignature(node: RawSnapshotNode): string | null {
  if (!node.rect) {
    return null;
  }
  const looseSignature = buildLooseHintSignature(node);
  if (!looseSignature) {
    return null;
  }
  return [looseSignature, node.rect.x, node.rect.y, node.rect.width, node.rect.height].join('|');
}

function buildLooseHintSignature(node: RawSnapshotNode): string | null {
  if (!node.type) {
    return null;
  }
  return [node.type, node.label ?? '', node.identifier ?? ''].join('|');
}
