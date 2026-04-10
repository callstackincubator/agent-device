import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import { runMacOsSnapshotAction } from '../../platforms/ios/macos-helper.ts';
import { snapshotLinux } from '../../platforms/linux/index.ts';
import type { AndroidSnapshotAnalysis } from '../../platforms/android/ui-hierarchy.ts';
import {
  attachRefs,
  findNodeByRef,
  normalizeRef,
  type RawSnapshotNode,
  type SnapshotBackend,
  type SnapshotState,
  type SnapshotVisibility,
} from '../../utils/snapshot.ts';
import { normalizeSnapshotTree } from '../../utils/snapshot-tree.ts';
import { buildMobileSnapshotPresentation } from '../../utils/mobile-snapshot-semantics.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import {
  ANDROID_FRESHNESS_RETRY_DELAYS_MS,
  clearAndroidSnapshotFreshness,
  getActiveAndroidSnapshotFreshness,
  isLikelySnapshotStuckOnPreviousRoute,
  isLikelyStaleSnapshotDrop,
  isNavigationSensitiveAction,
  type AndroidFreshnessCaptureMeta,
} from '../android-snapshot-freshness.ts';
import { contextFromFlags } from '../context.ts';
import { findNodeByLabel, pruneGroupNodes, resolveRefLabel } from '../snapshot-processing.ts';
import { errorResponse } from './response.ts';

function isDesktopBackend(backend: SnapshotBackend | undefined): boolean {
  return backend === 'macos-helper' || backend === 'linux-atspi';
}

type CaptureSnapshotParams = {
  device: SessionState['device'];
  session: SessionState | undefined;
  flags: CommandFlags | undefined;
  outPath?: string;
  logPath: string;
  snapshotScope?: string;
};

type SnapshotData = {
  nodes?: RawSnapshotNode[];
  truncated?: boolean;
  backend?: SnapshotBackend;
  analysis?: AndroidSnapshotAnalysis;
};

type AndroidFreshnessReason = 'empty-interactive' | 'sharp-drop' | 'stuck-route';

export async function captureSnapshot(params: CaptureSnapshotParams): Promise<{
  snapshot: SnapshotState;
  analysis?: AndroidSnapshotAnalysis;
  freshness?: AndroidFreshnessCaptureMeta;
}> {
  const freshness = getActiveAndroidSnapshotFreshness(params.session);
  if (freshness && params.device.platform === 'android') {
    return await captureAndroidFreshnessAwareSnapshot(params, freshness);
  }
  const data = await captureSnapshotData(params);
  clearAndroidSnapshotFreshness(params.session);
  return {
    snapshot: buildSnapshotState(data, params.flags),
    analysis: data.analysis,
  };
}

export async function captureSnapshotData(params: CaptureSnapshotParams): Promise<SnapshotData> {
  const { device, session, flags, outPath, logPath, snapshotScope } = params;
  if (device.platform === 'linux') {
    const linuxResult = await snapshotLinux(session?.surface);
    return shapeDesktopSurfaceSnapshot(
      { nodes: linuxResult.nodes, truncated: linuxResult.truncated, backend: 'linux-atspi' },
      {
        snapshotDepth: flags?.snapshotDepth,
        snapshotInteractiveOnly: flags?.snapshotInteractiveOnly,
        snapshotScope,
      },
    );
  }
  if (device.platform === 'macos' && session?.surface && session.surface !== 'app') {
    const helperSnapshot = await runMacOsSnapshotAction(session.surface, {
      bundleId: session.surface === 'menubar' ? session.appBundleId : undefined,
    });
    return shapeDesktopSurfaceSnapshot(helperSnapshot, {
      snapshotDepth: flags?.snapshotDepth,
      snapshotInteractiveOnly: flags?.snapshotInteractiveOnly,
      snapshotScope,
    });
  }
  return (await dispatchCommand(device, 'snapshot', [], outPath, {
    ...contextFromFlags(
      logPath,
      { ...flags, snapshotScope },
      session?.appBundleId,
      session?.trace?.outPath,
    ),
  })) as SnapshotData;
}

async function captureAndroidFreshnessAwareSnapshot(
  params: CaptureSnapshotParams,
  freshness: NonNullable<SessionState['androidSnapshotFreshness']>,
): Promise<{
  snapshot: SnapshotState;
  analysis?: AndroidSnapshotAnalysis;
  freshness?: AndroidFreshnessCaptureMeta;
}> {
  let latest = await captureSnapshotAttempt(params);
  let suspiciousReason = getAndroidFreshnessReason(latest, freshness, params.flags);
  let retryCount = 0;

  for (const delayMs of ANDROID_FRESHNESS_RETRY_DELAYS_MS) {
    if (!suspiciousReason) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    latest = await captureSnapshotAttempt(params);
    retryCount += 1;
    suspiciousReason = getAndroidFreshnessReason(latest, freshness, params.flags);
  }

  if (!suspiciousReason) {
    clearAndroidSnapshotFreshness(params.session);
  }

  return {
    snapshot: latest.snapshot,
    analysis: latest.data.analysis,
    freshness:
      retryCount > 0 || Boolean(suspiciousReason)
        ? {
            action: freshness.action,
            retryCount,
            staleAfterRetries: Boolean(suspiciousReason),
            reason: suspiciousReason ?? undefined,
          }
        : undefined,
  };
}

async function captureSnapshotAttempt(
  params: CaptureSnapshotParams,
): Promise<{ data: SnapshotData; snapshot: SnapshotState }> {
  const data = await captureSnapshotData(params);
  return {
    data,
    snapshot: buildSnapshotState(data, params.flags),
  };
}

function getAndroidFreshnessReason(
  attempt: { data: SnapshotData; snapshot: SnapshotState },
  freshness: NonNullable<SessionState['androidSnapshotFreshness']>,
  flags: CommandFlags | undefined,
): AndroidFreshnessReason | null {
  const interactiveOnly = flags?.snapshotInteractiveOnly === true;
  const analysis = attempt.data.analysis;

  // When interactive-only filtering produces zero visible nodes from ≥12 raw nodes,
  // the dump likely captured a transitional frame.  The 12-node floor avoids
  // false positives on deliberately minimal screens (splash, loading).
  if (
    interactiveOnly &&
    attempt.snapshot.nodes.length === 0 &&
    analysis &&
    analysis.rawNodeCount >= 12
  ) {
    return 'empty-interactive';
  }

  if (isLikelyStaleSnapshotDrop(freshness.baselineCount, attempt.snapshot.nodes.length)) {
    return !hasMeaningfulSnapshotContent(attempt.snapshot) ? 'sharp-drop' : null;
  }

  return freshness.routeComparable &&
    isNavigationSensitiveAction(freshness.action) &&
    isLikelySnapshotStuckOnPreviousRoute(freshness.baselineSignatures, attempt.snapshot.nodes)
    ? 'stuck-route'
    : null;
}

function hasMeaningfulSnapshotContent(snapshot: SnapshotState): boolean {
  return snapshot.nodes.some(
    (node) =>
      node.hittable === true ||
      Boolean(node.label?.trim()) ||
      Boolean(node.value?.trim()) ||
      Boolean(node.identifier?.trim()),
  );
}

export function buildSnapshotState(
  data: {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: SnapshotBackend;
  },
  flags:
    | (Pick<
        CommandFlags,
        'snapshotCompact' | 'snapshotDepth' | 'snapshotInteractiveOnly' | 'snapshotRaw'
      > &
        Partial<Pick<CommandFlags, 'snapshotScope'>>)
    | undefined,
): SnapshotState {
  const rawNodes = data?.nodes ?? [];
  const snapshotRaw = flags?.snapshotRaw;
  const normalizedNodes = normalizeSnapshotTree(snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  const scopedNodes =
    flags?.snapshotScope && data?.backend !== 'macos-helper'
      ? scopeSnapshotNodes(normalizedNodes, flags.snapshotScope)
      : normalizedNodes;
  const nodes = attachRefs(scopedNodes);
  return {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
    // Only broad Android snapshots become freshness baselines. If the user asked for a scoped
    // or filtered view, preserve that output contract but avoid pretending it is safe for
    // route-level comparisons on the next capture.
    comparisonSafe:
      data?.backend === 'android' &&
      flags?.snapshotInteractiveOnly !== true &&
      flags?.snapshotCompact !== true &&
      typeof flags?.snapshotDepth !== 'number' &&
      !flags?.snapshotScope,
  };
}

export function buildSnapshotVisibility(params: {
  nodes: SnapshotState['nodes'];
  backend?: SnapshotState['backend'];
  snapshotRaw?: boolean;
}): SnapshotVisibility {
  const { nodes, backend, snapshotRaw } = params;
  if (snapshotRaw || isDesktopBackend(backend)) {
    return {
      partial: false,
      visibleNodeCount: nodes.length,
      totalNodeCount: nodes.length,
      reasons: [],
    };
  }

  const presentation = buildMobileSnapshotPresentation(nodes);
  const reasons = new Set<SnapshotVisibility['reasons'][number]>();
  if (presentation.hiddenCount > 0) {
    reasons.add('offscreen-nodes');
  }
  if (presentation.nodes.some((node) => node.hiddenContentAbove)) {
    reasons.add('scroll-hidden-above');
  }
  if (presentation.nodes.some((node) => node.hiddenContentBelow)) {
    reasons.add('scroll-hidden-below');
  }

  return {
    partial: reasons.size > 0,
    visibleNodeCount: presentation.nodes.length,
    totalNodeCount: nodes.length,
    reasons: [...reasons],
  };
}

function shapeDesktopSurfaceSnapshot(
  data: SnapshotData,
  options: {
    snapshotDepth?: number;
    snapshotInteractiveOnly?: boolean;
    snapshotScope?: string;
  },
): SnapshotData {
  let nodes = data.nodes ?? [];
  if (options.snapshotScope) {
    nodes = scopeSnapshotNodes(nodes, options.snapshotScope);
  }
  if (options.snapshotInteractiveOnly) {
    nodes = filterInteractiveSnapshotNodes(nodes);
  }
  if (typeof options.snapshotDepth === 'number') {
    nodes = filterSnapshotNodesByDepth(nodes, options.snapshotDepth);
  }
  return { ...data, nodes };
}

function scopeSnapshotNodes(nodes: RawSnapshotNode[], scope: string): RawSnapshotNode[] {
  const scopedNodes = attachRefs(nodes);
  const match = findNodeByLabel(scopedNodes, scope);
  if (!match) {
    return [];
  }
  const startIndex = nodes.findIndex((node) => node.index === match.index);
  if (startIndex === -1) {
    return [];
  }
  const startDepth = nodes[startIndex]?.depth ?? 0;
  const slice: RawSnapshotNode[] = [];
  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const depth = node.depth ?? 0;
    if (index > startIndex && depth <= startDepth) {
      break;
    }
    slice.push(node);
  }
  return reindexSnapshotNodes(slice, startDepth);
}

function filterInteractiveSnapshotNodes(nodes: RawSnapshotNode[]): RawSnapshotNode[] {
  if (nodes.length === 0) {
    return nodes;
  }
  const byIndex = new Map<number, RawSnapshotNode>();
  for (const node of nodes) {
    byIndex.set(node.index, node);
  }
  const keepIndexes = new Set<number>();
  for (const node of nodes) {
    if (!isInteractiveSnapshotNode(node)) continue;
    let current: RawSnapshotNode | undefined = node;
    while (current) {
      if (keepIndexes.has(current.index)) break;
      keepIndexes.add(current.index);
      current =
        typeof current.parentIndex === 'number' ? byIndex.get(current.parentIndex) : undefined;
    }
  }
  if (keepIndexes.size === 0) {
    return nodes;
  }
  return reindexSnapshotNodes(nodes.filter((node) => keepIndexes.has(node.index)));
}

function filterSnapshotNodesByDepth(nodes: RawSnapshotNode[], maxDepth: number): RawSnapshotNode[] {
  return reindexSnapshotNodes(nodes.filter((node) => (node.depth ?? 0) <= maxDepth));
}

function reindexSnapshotNodes(nodes: RawSnapshotNode[], depthOffset = 0): RawSnapshotNode[] {
  const indexMap = new Map<number, number>();
  for (const [index, node] of nodes.entries()) {
    indexMap.set(node.index, index);
  }
  return nodes.map((node, index) => ({
    ...node,
    index,
    depth: Math.max(0, (node.depth ?? 0) - depthOffset),
    parentIndex: typeof node.parentIndex === 'number' ? indexMap.get(node.parentIndex) : undefined,
  }));
}

function isInteractiveSnapshotNode(node: RawSnapshotNode): boolean {
  if (node.hittable) return true;
  if (node.rect) return true;
  const role = `${node.type ?? ''} ${node.role ?? ''} ${node.subrole ?? ''}`.toLowerCase();
  return (
    role.includes('button') ||
    role.includes('menu') ||
    role.includes('textfield') ||
    role.includes('searchfield') ||
    role.includes('checkbox') ||
    role.includes('radio') ||
    role.includes('switch')
  );
}

export function resolveSnapshotScope(
  snapshotScope: string | undefined,
  session: SessionState | undefined,
): { ok: true; scope?: string } | { ok: false; response: DaemonResponse } {
  if (!snapshotScope || !snapshotScope.trim().startsWith('@')) {
    return { ok: true, scope: snapshotScope };
  }
  if (!session?.snapshot) {
    return {
      ok: false,
      response: errorResponse('INVALID_ARGS', 'Ref scope requires an existing snapshot in session.'),
    };
  }
  const ref = normalizeRef(snapshotScope.trim());
  if (!ref) {
    return {
      ok: false,
      response: errorResponse('INVALID_ARGS', `Invalid ref scope: ${snapshotScope}`),
    };
  }
  const node = findNodeByRef(session.snapshot.nodes, ref);
  const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
  if (!resolved) {
    return {
      ok: false,
      response: errorResponse('COMMAND_FAILED', `Ref ${snapshotScope} not found or has no label`),
    };
  }
  return { ok: true, scope: resolved };
}
