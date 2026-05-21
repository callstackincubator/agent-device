import type { Rect, SnapshotNode } from './snapshot.ts';
import { isEmailLikeLabel, normalizeRepeatedNodeLabel } from './snapshot-label-signals.ts';
import { displayNodeLabel } from './snapshot-tree.ts';

const ACTIONABLE_STRUCTURAL_TYPE_TOKENS = ['button', 'switch', 'checkbox', 'radio'];
const STRUCTURAL_NOISE_TYPE_TOKENS = ['button', 'image', 'textview', 'view'];

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

function isAndroidHelperSnapshot(data: Record<string, unknown>): boolean {
  const metadata = data.androidSnapshot;
  if (!metadata || typeof metadata !== 'object') return false;
  return (metadata as Record<string, unknown>).backend === 'android-helper';
}

function filterAndroidHelperTextOutputNodes(nodes: SnapshotNode[]): SnapshotNode[] {
  if (nodes.length === 0) return nodes;

  const removed = new Set<number>();
  const replacements = new Map<number, SnapshotNode>();
  markZeroAreaNodesForRemoval(nodes, removed);
  markBottomNavNodesNearComposerForRemoval(nodes, removed, replacements);
  markDuplicateEmailButtonsForRemoval(nodes, removed);
  markAdjacentDuplicateStructuralNodesForRemoval(nodes, removed, replacements);

  return nodes
    .filter((node) => !removed.has(node.index))
    .map((node) => replacements.get(node.index) ?? node);
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
  replacements: Map<number, SnapshotNode>,
): void {
  const composer = findBottomEditableNode(nodes);
  if (!composer?.rect) return;

  const navNodes = findBottomNavigationLikeNodes(nodes, composer.rect);
  for (const node of navNodes) {
    addPresentationHints(replacements, node, ['likely navigation']);
    markDescendantsForRemoval(nodes, node.index, removed);
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

function markAdjacentDuplicateStructuralNodesForRemoval(
  nodes: SnapshotNode[],
  removed: Set<number>,
  replacements: Map<number, SnapshotNode>,
): void {
  const lastByLabel = new Map<string, SnapshotNode>();
  for (const node of nodes) {
    if (removed.has(node.index) || !isStructuralNoiseCandidate(node)) {
      continue;
    }
    const label = normalizeStructuralNodeLabel(displayNodeLabel(node));
    if (!label) continue;

    // RN can expose the same visible row content through parallel typed siblings
    // such as ImageView + Button or TextView + Button, so label is the signature.
    const previous = lastByLabel.get(label);
    if (previous && shouldCollapseAdjacentStructuralDuplicate(previous, node, removed)) {
      const survivor = collapseAdjacentStructuralDuplicate(
        nodes,
        previous,
        node,
        removed,
        replacements,
      );
      lastByLabel.set(label, survivor);
      continue;
    }
    lastByLabel.set(label, node);
  }
}

function shouldCollapseAdjacentStructuralDuplicate(
  previous: SnapshotNode,
  node: SnapshotNode,
  removed: Set<number>,
): boolean {
  return (
    !removed.has(previous.index) &&
    areSameVisualRow(previous.rect, node.rect) &&
    areStructurallyAdjacentForCollapse(previous, node)
  );
}

function collapseAdjacentStructuralDuplicate(
  nodes: SnapshotNode[],
  previous: SnapshotNode,
  node: SnapshotNode,
  removed: Set<number>,
  replacements: Map<number, SnapshotNode>,
): SnapshotNode {
  const survivor = chooseStructuralRepresentative(previous, node);
  const collapsed = survivor.index === previous.index ? node : previous;
  const collapsedHint = imagePresentationHint(collapsed);
  addPresentationHints(replacements, survivor, [
    ...readPresentationHints(replacements.get(collapsed.index) ?? collapsed),
    ...(collapsedHint ? [collapsedHint] : []),
  ]);
  markNodeAndDescendantsForRemoval(nodes, collapsed.index, removed);
  return replacements.get(survivor.index) ?? survivor;
}

function markNodeAndDescendantsForRemoval(
  nodes: SnapshotNode[],
  rootIndex: number,
  removed: Set<number>,
): void {
  removed.add(rootIndex);
  markDescendantsForRemoval(nodes, rootIndex, removed);
}

function markDescendantsForRemoval(
  nodes: SnapshotNode[],
  rootIndex: number,
  removed: Set<number>,
): void {
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

function addPresentationHints(
  replacements: Map<number, SnapshotNode>,
  node: SnapshotNode,
  hints: string[],
): void {
  const existing = replacements.get(node.index) ?? node;
  const merged = [...new Set([...readPresentationHints(existing), ...hints.filter(Boolean)])];
  replacements.set(node.index, {
    ...existing,
    presentationHints: merged,
  });
}

function readPresentationHints(node: SnapshotNode): string[] {
  return Array.isArray(node.presentationHints) ? node.presentationHints : [];
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

function isStructuralNoiseCandidate(node: SnapshotNode): boolean {
  if (!node.rect || !hasRenderableArea(node.rect) || isRootNode(node) || isEditableNode(node)) {
    return false;
  }
  const type = (node.type ?? '').toLowerCase();
  return type === 'text' || hasAnyTypeToken(type, STRUCTURAL_NOISE_TYPE_TOKENS);
}

function chooseStructuralRepresentative(left: SnapshotNode, right: SnapshotNode): SnapshotNode {
  const leftScore = structuralRepresentativeScore(left);
  const rightScore = structuralRepresentativeScore(right);
  return rightScore > leftScore ? right : left;
}

function structuralRepresentativeScore(node: SnapshotNode): number {
  const type = (node.type ?? '').toLowerCase();
  let score = 0;
  if (hasAnyTypeToken(type, ACTIONABLE_STRUCTURAL_TYPE_TOKENS)) {
    score += 100;
  } else if (type.includes('image')) {
    score += 30;
  } else if (type.includes('textview') || type === 'text') {
    score += 20;
  } else if (type.includes('view')) {
    score += 10;
  }
  if (node.hittable === true) score += 20;
  if (node.enabled !== false) score += 5;
  return score;
}

function hasAnyTypeToken(type: string, tokens: string[]): boolean {
  return tokens.some((token) => type.includes(token));
}

function imagePresentationHint(node: SnapshotNode): string | null {
  return (node.type ?? '').toLowerCase().includes('image') ? 'has image' : null;
}

function areStructurallyAdjacentForCollapse(left: SnapshotNode, right: SnapshotNode): boolean {
  if (areStructurallyAdjacent(left, right)) {
    return true;
  }
  return isPassiveChildOfActionableDuplicate(left, right);
}

function isPassiveChildOfActionableDuplicate(left: SnapshotNode, right: SnapshotNode): boolean {
  const parent =
    left.parentIndex === right.index ? right : right.parentIndex === left.index ? left : null;
  const child = parent?.index === left.index ? right : parent?.index === right.index ? left : null;
  if (!parent || !child) return false;
  return chooseStructuralRepresentative(parent, child).index === parent.index;
}

function normalizeStructuralNodeLabel(label: string): string | null {
  const normalized = label.trim().replace(/\s+/g, ' ').toLowerCase();
  if (!normalized) return null;
  if (/^(true|false|\d+)$/.test(normalized)) return null;
  return normalized;
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

function bucket(value: number, size: number): number {
  return Math.round(value / size);
}

function areSameVisualRow(left: Rect | undefined, right: Rect | undefined): boolean {
  if (!left || !right) return true;
  const leftCenterY = left.y + left.height / 2;
  const rightCenterY = right.y + right.height / 2;
  return Math.abs(leftCenterY - rightCenterY) <= Math.max(left.height, right.height, 1);
}

function areStructurallyAdjacent(left: SnapshotNode, right: SnapshotNode): boolean {
  if (left.parentIndex === right.parentIndex) {
    return Math.abs(left.index - right.index) <= 3;
  }
  if (left.parentIndex === right.index || right.parentIndex === left.index) {
    return false;
  }
  return (
    Math.abs((left.depth ?? 0) - (right.depth ?? 0)) <= 1 && Math.abs(left.index - right.index) <= 2
  );
}
