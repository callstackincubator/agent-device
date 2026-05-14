import type { Rect, SnapshotNode } from './snapshot.ts';
import { displayNodeLabel } from './snapshot-tree.ts';

export type AndroidHelperPresentationInput = {
  nodes: SnapshotNode[];
  filteredCount: number;
};

export function buildAndroidHelperPresentationInput(
  data: Record<string, unknown>,
  nodes: SnapshotNode[],
  options: { raw?: boolean },
): AndroidHelperPresentationInput {
  if (options.raw || !isAndroidHelperSnapshot(data)) {
    return { nodes, filteredCount: 0 };
  }
  const filtered = filterAndroidHelperTextOutputNodes(nodes);
  return {
    nodes: filtered,
    filteredCount: nodes.length - filtered.length,
  };
}

export function detectPossibleRepeatedNavSubtree(nodes: SnapshotNode[]): boolean {
  if (nodes.length < 20) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const type = (node.type ?? '').toLowerCase();
    const label = normalizeRepeatedNodeLabel(displayNodeLabel(node));
    if (!label) continue;
    const signature = `${type}|${label}`;
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  let duplicateCount = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      duplicateCount += count;
    }
  }
  return duplicateCount >= 8;
}

function isAndroidHelperSnapshot(data: Record<string, unknown>): boolean {
  const metadata = data.androidSnapshot;
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>).backend === 'android-helper';
}

function filterAndroidHelperTextOutputNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  if (nodes.length === 0) return nodes;

  const removed = new Set<number>();
  markZeroAreaNodesForRemoval(nodes, removed);
  markBottomNavNodesNearComposerForRemoval(nodes, removed);
  markDuplicateEmailButtonsForRemoval(nodes, removed);

  return nodes.filter((node) => !removed.has(node.index));
}

function markZeroAreaNodesForRemoval(nodes: SnapshotNode[], removed: Set<number>): void {
  for (const node of nodes) {
    if (!node.rect || hasRenderableArea(node.rect) || isRootNode(node)) {
      continue;
    }
    markNodeAndDescendantsForRemoval(nodes, node.index, removed);
  }
}

function markBottomNavNodesNearComposerForRemoval(
  nodes: SnapshotNode[],
  removed: Set<number>,
): void {
  const composer = findBottomEditableNode(nodes);
  if (!composer?.rect) return;

  const navNodes = findBottomNavigationLikeNodes(nodes, composer.rect);
  for (const node of navNodes) {
    markNodeAndDescendantsForRemoval(nodes, node.index, removed);
  }
}

function markDuplicateEmailButtonsForRemoval(nodes: SnapshotNode[], removed: Set<number>): void {
  const seenByParent = new Map<string, SnapshotNode>();
  for (const node of nodes) {
    if (removed.has(node.index) || !isEmailLikeLabel(displayNodeLabel(node))) {
      continue;
    }
    const parentKey = typeof node.parentIndex === 'number' ? String(node.parentIndex) : 'root';
    const signature = `${parentKey}|${displayNodeLabel(node).trim().toLowerCase()}`;
    const previous = seenByParent.get(signature);
    if (!previous) {
      seenByParent.set(signature, node);
      continue;
    }
    if (areSameVisualRow(previous.rect, node.rect)) {
      markNodeAndDescendantsForRemoval(nodes, node.index, removed);
    }
  }
}

function markNodeAndDescendantsForRemoval(
  nodes: SnapshotNode[],
  rootIndex: number,
  removed: Set<number>,
): void {
  removed.add(rootIndex);
  const pending = [rootIndex];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const node of nodes) {
      if (node.parentIndex !== current || removed.has(node.index)) continue;
      removed.add(node.index);
      pending.push(node.index);
    }
  }
}

function hasRenderableArea(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0;
}

function isRootNode(node: SnapshotNode): boolean {
  return typeof node.parentIndex !== 'number';
}

function resolveLikelyViewport(nodes: SnapshotNode[]): Rect | null {
  let best: Rect | null = null;
  let bestArea = 0;
  for (const node of nodes) {
    if (!node.rect || !hasRenderableArea(node.rect)) continue;
    const area = node.rect.width * node.rect.height;
    if (area > bestArea) {
      best = node.rect;
      bestArea = area;
    }
  }
  return best;
}

function findBottomEditableNode(nodes: SnapshotNode[]): SnapshotNode | null {
  const viewport = resolveLikelyViewport(nodes);
  const lowerBound = viewport ? viewport.y + viewport.height * 0.65 : Number.NEGATIVE_INFINITY;
  return (
    nodes.find((node) => {
      if (!node.rect || node.rect.y < lowerBound) return false;
      return isEditableNode(node);
    }) ?? null
  );
}

function findBottomNavigationLikeNodes(nodes: SnapshotNode[], composerRect: Rect): SnapshotNode[] {
  const rows = new Map<string, SnapshotNode[]>();
  for (const node of nodes) {
    if (!isBottomNavigationCandidate(node, nodes, composerRect)) continue;
    const rect = node.rect!;
    const parentKey = typeof node.parentIndex === 'number' ? String(node.parentIndex) : 'root';
    const rowKey = [
      parentKey,
      bucket(rect.y + rect.height / 2, 24),
      bucket(rect.width, 24),
      bucket(rect.height, 24),
    ].join('|');
    const row = rows.get(rowKey);
    if (row) {
      row.push(node);
    } else {
      rows.set(rowKey, [node]);
    }
  }

  const navigationNodes: SnapshotNode[] = [];
  for (const row of rows.values()) {
    if (!isBottomNavigationRow(row, nodes, composerRect)) continue;
    navigationNodes.push(...row);
  }
  return navigationNodes;
}

function isNearComposerVerticalBand(rect: Rect, composerRect: Rect): boolean {
  const tolerance = Math.max(composerRect.height * 2, 96);
  return (
    rect.y <= composerRect.y + composerRect.height + tolerance &&
    rect.y + rect.height >= composerRect.y - tolerance
  );
}

function isBottomNavigationCandidate(
  node: SnapshotNode,
  nodes: SnapshotNode[],
  composerRect: Rect,
): boolean {
  if (
    !node.rect ||
    !hasRenderableArea(node.rect) ||
    isRootNode(node) ||
    isEditableNode(node) ||
    isTextOnlyNode(node) ||
    !isNearComposerVerticalBand(node.rect, composerRect)
  ) {
    return false;
  }
  return normalizeRepeatedNodeLabel(getNodeOrDescendantLabel(node, nodes)) !== null;
}

function isBottomNavigationRow(
  row: SnapshotNode[],
  nodes: SnapshotNode[],
  composerRect: Rect,
): boolean {
  if (row.length < 3) return false;
  const labels = new Set<string>();
  for (const node of row) {
    const label = normalizeRepeatedNodeLabel(getNodeOrDescendantLabel(node, nodes));
    if (label) labels.add(label);
  }
  if (labels.size < 3) return false;

  const sorted = [...row].sort((left, right) => left.rect!.x - right.rect!.x);
  const first = sorted[0]!.rect!;
  const last = sorted[sorted.length - 1]!.rect!;
  const horizontalSpan = last.x + last.width - first.x;
  return horizontalSpan >= composerRect.width;
}

function isEditableNode(node: SnapshotNode): boolean {
  const type = (node.type ?? '').toLowerCase();
  const identifier = (node.identifier ?? '').trim().toLowerCase();
  return type.includes('edittext') || type.includes('textfield') || identifier === 'composer';
}

function isTextOnlyNode(node: SnapshotNode): boolean {
  const type = (node.type ?? '').toLowerCase();
  return type.includes('textview') || type === 'text';
}

function getNodeOrDescendantLabel(node: SnapshotNode, nodes: SnapshotNode[]): string {
  const label = displayNodeLabel(node);
  if (label.trim()) return label;
  const pending = [node.index];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const child of nodes) {
      if (child.parentIndex !== current) continue;
      const childLabel = displayNodeLabel(child);
      if (childLabel.trim()) return childLabel;
      pending.push(child.index);
    }
  }
  return '';
}

function normalizeRepeatedNodeLabel(label: string): string | null {
  const normalized = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized || isEmailLikeLabel(normalized)) return null;
  return normalized;
}

function bucket(value: number, size: number): number {
  return Math.round(value / size);
}

function isEmailLikeLabel(label: string): boolean {
  return /\S+@\S+\.\S+/.test(label);
}

function areSameVisualRow(left: Rect | undefined, right: Rect | undefined): boolean {
  if (!left || !right) return true;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterY = right.y + right.height / 2;
  return Math.abs(leftCenterY - rightCenterY) <= Math.max(left.height, right.height, 1);
}
