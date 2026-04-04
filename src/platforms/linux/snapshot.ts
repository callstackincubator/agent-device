import type { RawSnapshotNode, SnapshotOptions } from '../../utils/snapshot.ts';
import { captureAccessibilityTree, type SnapshotSurface } from './atspi-bridge.ts';
import type { SessionSurface } from '../../core/session-surface.ts';

/**
 * Map the session-level surface to an AT-SPI2 surface.
 * Linux supports 'desktop' and 'frontmost-app'. The 'app' surface
 * (used for in-app XCTest sessions) is treated as 'frontmost-app' on Linux.
 * The 'menubar' surface is not yet supported; it falls back to 'desktop'.
 */
function resolveLinuxSurface(surface: SessionSurface | undefined): SnapshotSurface {
  if (surface === 'desktop') return 'desktop';
  if (surface === 'frontmost-app' || surface === 'app') return 'frontmost-app';
  // 'menubar' and undefined default to desktop
  return 'desktop';
}

export async function snapshotLinux(
  surface: SessionSurface | undefined,
  options: SnapshotOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
}> {
  const linuxSurface = resolveLinuxSurface(surface);

  const result = await captureAccessibilityTree(linuxSurface, {
    maxNodes: undefined, // use defaults
    maxDepth: options.depth,
  });

  let nodes = result.nodes;

  if (options.scope) {
    nodes = scopeNodes(nodes, options.scope);
  }

  if (options.interactiveOnly) {
    nodes = filterInteractive(nodes);
  }

  if (typeof options.depth === 'number') {
    nodes = nodes.filter((n) => (n.depth ?? 0) <= options.depth!);
  }

  return {
    nodes,
    truncated: result.truncated,
  };
}

function scopeNodes(nodes: RawSnapshotNode[], scope: string): RawSnapshotNode[] {
  const lowerScope = scope.toLowerCase();
  const matchIndex = nodes.findIndex(
    (n) => n.label?.toLowerCase().includes(lowerScope) || n.appName?.toLowerCase().includes(lowerScope),
  );
  if (matchIndex === -1) return [];

  const startDepth = nodes[matchIndex]?.depth ?? 0;
  const result: RawSnapshotNode[] = [];
  for (let i = matchIndex; i < nodes.length; i++) {
    const node = nodes[i];
    if (!node) continue;
    const depth = node.depth ?? 0;
    if (i > matchIndex && depth <= startDepth) break;
    result.push(node);
  }
  return result;
}

function filterInteractive(nodes: RawSnapshotNode[]): RawSnapshotNode[] {
  const keepIndexes = new Set<number>();
  const byIndex = new Map<number, RawSnapshotNode>();
  for (const node of nodes) byIndex.set(node.index, node);

  for (const node of nodes) {
    if (!node.hittable && !node.rect) continue;
    let current: RawSnapshotNode | undefined = node;
    while (current) {
      if (keepIndexes.has(current.index)) break;
      keepIndexes.add(current.index);
      current = typeof current.parentIndex === 'number' ? byIndex.get(current.parentIndex) : undefined;
    }
  }

  if (keepIndexes.size === 0) return nodes;
  return nodes.filter((n) => keepIndexes.has(n.index));
}
