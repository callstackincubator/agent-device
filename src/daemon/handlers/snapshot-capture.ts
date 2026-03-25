import { dispatchCommand } from '../../core/dispatch.ts';
import { runMacOsSnapshotAction } from '../../platforms/ios/macos-helper.ts';
import {
  attachRefs,
  findNodeByRef,
  normalizeRef,
  type RawSnapshotNode,
  type SnapshotState,
} from '../../utils/snapshot.ts';
import type { DaemonResponse, DaemonRequest, SessionState } from '../types.ts';
import { contextFromFlags } from '../context.ts';
import { findNodeByLabel, pruneGroupNodes, resolveRefLabel } from '../snapshot-processing.ts';

type CaptureSnapshotParams = {
  dispatchSnapshotCommand: typeof dispatchCommand;
  device: SessionState['device'];
  session: SessionState | undefined;
  req: DaemonRequest;
  logPath: string;
  snapshotScope?: string;
};

type SnapshotData = {
  nodes?: RawSnapshotNode[];
  truncated?: boolean;
  backend?: 'xctest' | 'android' | 'macos-helper';
};

export async function captureSnapshot(
  params: CaptureSnapshotParams,
): Promise<{ snapshot: SnapshotState }> {
  const { req } = params;
  const data = await captureSnapshotData(params);
  return { snapshot: buildSnapshotState(data, req.flags?.snapshotRaw) };
}

export async function captureSnapshotData(params: CaptureSnapshotParams): Promise<SnapshotData> {
  const { dispatchSnapshotCommand, device, session, req, logPath, snapshotScope } = params;
  if (device.platform === 'macos' && session?.surface && session.surface !== 'app') {
    const helperSnapshot = await runMacOsSnapshotAction(session.surface);
    return shapeMacOsSurfaceSnapshot(helperSnapshot, {
      snapshotDepth: req.flags?.snapshotDepth,
      snapshotInteractiveOnly: req.flags?.snapshotInteractiveOnly,
      snapshotScope,
    });
  }
  return (await dispatchSnapshotCommand(device, 'snapshot', [], req.flags?.out, {
    ...contextFromFlags(
      logPath,
      { ...req.flags, snapshotScope },
      session?.appBundleId,
      session?.trace?.outPath,
    ),
  })) as SnapshotData;
}

export function buildSnapshotState(
  data: {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android' | 'macos-helper';
  },
  snapshotRaw: boolean | undefined,
): SnapshotState {
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  return {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
}

function shapeMacOsSurfaceSnapshot(
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
      response: {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'Ref scope requires an existing snapshot in session.',
        },
      },
    };
  }
  const ref = normalizeRef(snapshotScope.trim());
  if (!ref) {
    return {
      ok: false,
      response: {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `Invalid ref scope: ${snapshotScope}` },
      },
    };
  }
  const node = findNodeByRef(session.snapshot.nodes, ref);
  const resolved = node ? resolveRefLabel(node, session.snapshot.nodes) : undefined;
  if (!resolved) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${snapshotScope} not found or has no label`,
        },
      },
    };
  }
  return { ok: true, scope: resolved };
}
