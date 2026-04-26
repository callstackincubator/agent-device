import { runCmd } from '../../utils/exec.ts';
import { withRetry } from '../../utils/retry.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import {
  attachRefs,
  type HiddenContentHint,
  type RawSnapshotNode,
  type SnapshotOptions,
} from '../../utils/snapshot.ts';
import { isScrollableType } from '../../utils/scrollable.ts';
import { deriveMobileSnapshotHiddenContentHints } from '../../utils/mobile-snapshot-semantics.ts';
import {
  buildUiHierarchySnapshot,
  parseUiHierarchy,
  parseUiHierarchyTree,
  type AndroidBuiltSnapshot,
  type AndroidSnapshotAnalysis,
  type AndroidUiHierarchy,
} from './ui-hierarchy.ts';
import { adbArgs } from './adb.ts';
import { deriveAndroidScrollableContentHints } from './scroll-hints.ts';
import {
  captureAndroidSnapshotWithHelper,
  ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS,
  ensureAndroidSnapshotHelper,
  type AndroidAdbExecutor,
  type AndroidSnapshotHelperArtifact,
  type AndroidSnapshotHelperInstallPolicy,
} from './snapshot-helper.ts';
import {
  helperFallbackReason,
  resolveAndroidSnapshotHelperConfig,
} from './snapshot-helper-config.ts';
import {
  ANDROID_SNAPSHOT_MAX_NODES,
  type AndroidSnapshotBackendMetadata,
} from './snapshot-types.ts';

const UI_HIERARCHY_DUMP_TIMEOUT_MS = 8_000;
const HELPER_INSTALL_TIMEOUT_MS = 30_000;
const HELPER_COMMAND_TIMEOUT_MS = UI_HIERARCHY_DUMP_TIMEOUT_MS + 5_000;

type AndroidSnapshotOptions = SnapshotOptions & {
  helperArtifact?: AndroidSnapshotHelperArtifact;
  helperInstallPolicy?: AndroidSnapshotHelperInstallPolicy;
  helperAdb?: AndroidAdbExecutor;
};

export async function snapshotAndroid(
  device: DeviceInfo,
  options: AndroidSnapshotOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
  androidSnapshot: AndroidSnapshotBackendMetadata;
}> {
  const capture = await captureAndroidUiHierarchy(device, options);
  const xml = capture.xml;
  if (!options.interactiveOnly) {
    const parsed = parseUiHierarchy(xml, ANDROID_SNAPSHOT_MAX_NODES, options);
    const nativeHints = await deriveScrollableContentHintsIfNeeded(device, parsed.nodes);
    applyHiddenContentHintsToNodes(nativeHints, parsed.nodes);
    return { ...parsed, androidSnapshot: capture.metadata };
  }

  const tree = parseUiHierarchyTree(xml);
  const fullSnapshot = buildUiHierarchySnapshot(tree, ANDROID_SNAPSHOT_MAX_NODES, {
    ...options,
    interactiveOnly: false,
  });
  const interactiveSnapshot = buildUiHierarchySnapshot(tree, ANDROID_SNAPSHOT_MAX_NODES, options);
  const nativeHints = await deriveScrollableContentHintsIfNeeded(device, fullSnapshot.nodes);
  applyHiddenContentHintsToInteractiveNodes(nativeHints, fullSnapshot, interactiveSnapshot);
  if (nativeHints.size === 0) {
    const presentationHints = deriveMobileSnapshotHiddenContentHints(
      attachRefs(fullSnapshot.nodes),
    );
    applyHiddenContentHintsToInteractiveNodes(presentationHints, fullSnapshot, interactiveSnapshot);
  }
  const { sourceNodes: _sourceNodes, ...snapshot } = interactiveSnapshot;
  return { ...snapshot, androidSnapshot: capture.metadata };
}

async function captureAndroidUiHierarchy(
  device: DeviceInfo,
  options: AndroidSnapshotOptions,
): Promise<{ xml: string; metadata: AndroidSnapshotBackendMetadata }> {
  const helperConfig = await resolveAndroidSnapshotHelperConfig(options);
  if (helperConfig.artifact) {
    try {
      const adb = options.helperAdb ?? createDeviceAdbExecutor(device);
      const install = await ensureAndroidSnapshotHelper({
        adb,
        artifact: helperConfig.artifact,
        installPolicy: options.helperInstallPolicy,
        timeoutMs: HELPER_INSTALL_TIMEOUT_MS,
      });
      const capture = await captureAndroidSnapshotWithHelper({
        adb,
        packageName: helperConfig.artifact.manifest.packageName,
        instrumentationRunner: helperConfig.artifact.manifest.instrumentationRunner,
        waitForIdleTimeoutMs: ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS,
        timeoutMs: UI_HIERARCHY_DUMP_TIMEOUT_MS,
        commandTimeoutMs: HELPER_COMMAND_TIMEOUT_MS,
      });
      return {
        xml: capture.xml,
        metadata: {
          backend: 'android-helper',
          helperVersion: helperConfig.artifact.manifest.version,
          helperApiVersion: capture.metadata.helperApiVersion,
          installReason: install.reason,
          waitForIdleTimeoutMs: capture.metadata.waitForIdleTimeoutMs,
          timeoutMs: capture.metadata.timeoutMs,
          maxDepth: capture.metadata.maxDepth,
          maxNodes: capture.metadata.maxNodes,
          rootPresent: capture.metadata.rootPresent,
          nodeCount: capture.metadata.nodeCount,
          helperTruncated: capture.metadata.truncated,
          elapsedMs: capture.metadata.elapsedMs,
        },
      };
    } catch (error) {
      return await captureStockUiHierarchy(device, helperFallbackReason(error));
    }
  }

  return await captureStockUiHierarchy(device, helperConfig.fallbackReason);
}

async function captureStockUiHierarchy(
  device: DeviceInfo,
  fallbackReason?: string,
): Promise<{ xml: string; metadata: AndroidSnapshotBackendMetadata }> {
  return {
    xml: await dumpUiHierarchy(device),
    metadata: {
      backend: 'uiautomator-dump',
      ...(fallbackReason ? { fallbackReason } : {}),
    },
  };
}

function createDeviceAdbExecutor(device: DeviceInfo): AndroidAdbExecutor {
  return async (args, options) => await runCmd('adb', adbArgs(device, args), options);
}

async function deriveScrollableContentHintsIfNeeded(
  device: DeviceInfo,
  nodes: RawSnapshotNode[],
): Promise<Map<number, HiddenContentHint>> {
  if (!nodes.some((node) => isScrollableType(node.type))) {
    return new Map();
  }
  const activityTopDump = await dumpActivityTop(device);
  if (!activityTopDump) {
    return new Map();
  }
  return deriveAndroidScrollableContentHints(nodes, activityTopDump);
}

export async function dumpUiHierarchy(device: DeviceInfo): Promise<string> {
  try {
    return await withRetry(() => dumpUiHierarchyOnce(device), {
      shouldRetry: isRetryableAdbError,
    });
  } catch (error) {
    if (isUiHierarchyDumpTimeout(error)) {
      const hint =
        'If the app has looping animations, use screenshot as visual truth, try settings animations off, then retry snapshot. Stock Android UIAutomator may still time out on app-owned infinite animations.';
      throw new AppError(
        'COMMAND_FAILED',
        `Android UI hierarchy dump timed out while waiting for the UI to become idle. ${hint}`,
        {
          ...(error.details ?? {}),
          hint,
        },
        error,
      );
    }
    throw error;
  }
}

async function dumpUiHierarchyOnce(device: DeviceInfo): Promise<string> {
  // Preferred: stream XML directly to stdout, avoiding file I/O race conditions.
  const streamed = await runCmd(
    'adb',
    adbArgs(device, ['exec-out', 'uiautomator', 'dump', '/dev/tty']),
    { allowFailure: true, timeoutMs: UI_HIERARCHY_DUMP_TIMEOUT_MS },
  );
  const fromStream = extractUiDumpXml(streamed.stdout, streamed.stderr);
  if (fromStream) return fromStream;

  // Fallback: dump to file and read back.
  // If `cat` fails with "no such file", the outer withRetry (via isRetryableAdbError) handles it.
  const dumpPath = '/sdcard/window_dump.xml';
  const dumpResult = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'uiautomator', 'dump', dumpPath]),
    { allowFailure: true, timeoutMs: UI_HIERARCHY_DUMP_TIMEOUT_MS },
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
  const rawStderr = err.details?.stderr;
  const stderr = (typeof rawStderr === 'string' ? rawStderr : '').toLowerCase();
  if (stderr.includes('device offline')) return true;
  if (stderr.includes('device not found')) return true;
  if (stderr.includes('transport error')) return true;
  if (stderr.includes('connection reset')) return true;
  if (stderr.includes('broken pipe')) return true;
  if (stderr.includes('timed out')) return true;
  if (stderr.includes('no such file or directory')) return true;
  return false;
}

function isUiHierarchyDumpTimeout(err: unknown): err is AppError {
  if (!(err instanceof AppError)) return false;
  if (err.code !== 'COMMAND_FAILED') return false;
  const timeoutMs = err.details?.timeoutMs;
  if (typeof timeoutMs !== 'number') return false;
  const cmd = err.details?.cmd;
  const rawArgs = err.details?.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map(String)
    : typeof rawArgs === 'string'
      ? rawArgs.split(/\s+/)
      : [];
  return cmd === 'adb' && args.includes('uiautomator') && args.includes('dump');
}

async function dumpActivityTop(device: DeviceInfo): Promise<string | null> {
  try {
    const result = await runCmd('adb', adbArgs(device, ['shell', 'dumpsys', 'activity', 'top']), {
      allowFailure: true,
      timeoutMs: 8_000,
    });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function applyHiddenContentHintsToInteractiveNodes(
  hintsByFullNodeIndex: ReadonlyMap<number, HiddenContentHint>,
  fullSnapshot: AndroidBuiltSnapshot,
  interactiveSnapshot: AndroidBuiltSnapshot,
): void {
  if (hintsByFullNodeIndex.size === 0) {
    return;
  }

  // Both snapshots come from one parsed hierarchy, so source node identity is the stable bridge
  // between full geometry context and the pruned interactive output.
  const interactiveNodesBySource = new Map<AndroidUiHierarchy, RawSnapshotNode>();
  for (const [index, sourceNode] of interactiveSnapshot.sourceNodes.entries()) {
    const node = interactiveSnapshot.nodes[index];
    if (node) {
      interactiveNodesBySource.set(sourceNode, node);
    }
  }

  for (const [fullIndex, hint] of hintsByFullNodeIndex) {
    const sourceNode = fullSnapshot.sourceNodes[fullIndex];
    if (!sourceNode) {
      continue;
    }
    const interactiveNode = interactiveNodesBySource.get(sourceNode);
    if (!interactiveNode) {
      continue;
    }
    if (hint.hiddenContentAbove) {
      interactiveNode.hiddenContentAbove = true;
    }
    if (hint.hiddenContentBelow) {
      interactiveNode.hiddenContentBelow = true;
    }
  }
}

function applyHiddenContentHintsToNodes(
  hintsByIndex: ReadonlyMap<number, HiddenContentHint>,
  nodes: RawSnapshotNode[],
): void {
  for (const [index, hint] of hintsByIndex) {
    const node = nodes[index];
    if (!node) {
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
