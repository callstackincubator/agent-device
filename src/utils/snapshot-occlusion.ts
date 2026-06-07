import type { RawSnapshotNode, Rect } from './snapshot.ts';
import { centerOfRect } from './snapshot.ts';
import { containsPoint } from './rect-visibility.ts';
import { normalizeType } from './text-surface.ts';

const COVERED_PRESENTATION_HINT = 'covered';

export function annotateCoveredSnapshotNodes(nodes: RawSnapshotNode[]): RawSnapshotNode[] {
  if (nodes.length < 2) return nodes;

  const byIndex = new Map(nodes.map((node) => [node.index, node]));
  let changed = false;
  const annotated = nodes.map((node, position) => {
    if (!isCandidateTouchNode(node)) return node;
    const cover = findCoveringNode(nodes, position, node, byIndex);
    if (!cover) return node;
    changed = true;
    return {
      ...node,
      hittable: false,
      interactionBlocked: 'covered' as const,
      presentationHints: mergeCoveredHint(node.presentationHints),
    };
  });

  return changed ? annotated : nodes;
}

export function isSnapshotNodeInteractionBlocked(
  node: Pick<RawSnapshotNode, 'interactionBlocked'>,
): boolean {
  return node.interactionBlocked === 'covered';
}

function findCoveringNode(
  nodes: RawSnapshotNode[],
  targetPosition: number,
  target: RawSnapshotNode,
  byIndex: Map<number, RawSnapshotNode>,
): RawSnapshotNode | null {
  const targetRect = validRect(target.rect);
  if (!targetRect) return null;
  const center = centerOfRect(targetRect);

  for (let position = targetPosition + 1; position < nodes.length; position += 1) {
    const candidate = nodes[position];
    if (!candidate || !isOverlayLikeNode(candidate)) continue;
    if (areRelatedSnapshotNodes(target, candidate, byIndex)) continue;
    const candidateRect = validRect(candidate.rect);
    if (!candidateRect || areRectsApproximatelyEqual(targetRect, candidateRect)) continue;
    if (containsPoint(candidateRect, center.x, center.y)) {
      return candidate;
    }
  }

  return null;
}

function isCandidateTouchNode(node: RawSnapshotNode): boolean {
  if (!validRect(node.rect)) return false;
  if (node.hittable === true) return true;
  if (isSemanticTouchNode(node)) return true;
  return Boolean(node.label?.trim() || node.value?.trim() || node.identifier?.trim());
}

function isOverlayLikeNode(node: RawSnapshotNode): boolean {
  if (!validRect(node.rect)) return false;
  if (isViewportRoot(node)) return false;
  if (node.hittable === true) return true;

  const normalized = normalizeNodeKind(node);
  return (
    normalized.includes('tabbar') ||
    normalized.includes('toolbar') ||
    normalized.includes('navigationbar') ||
    normalized.includes('bottomnavigation') ||
    normalized.includes('bottomnavigationview') ||
    normalized.includes('sheet') ||
    normalized.includes('dialog') ||
    normalized.includes('alert') ||
    normalized.includes('popover') ||
    normalized.includes('menu')
  );
}

function isSemanticTouchNode(node: RawSnapshotNode): boolean {
  const normalized = normalizeNodeKind(node);
  return (
    normalized.includes('button') ||
    normalized.includes('link') ||
    normalized.includes('menuitem') ||
    normalized.includes('tabitem') ||
    normalized.includes('textfield') ||
    normalized.includes('searchfield') ||
    normalized.includes('edittext') ||
    normalized.includes('checkbox') ||
    normalized.includes('radio') ||
    normalized.includes('switch') ||
    normalized.includes('cell')
  );
}

function normalizeNodeKind(node: Pick<RawSnapshotNode, 'type' | 'role' | 'subrole'>): string {
  return [node.type, node.role, node.subrole].map((value) => normalizeType(value ?? '')).join(' ');
}

function isViewportRoot(node: RawSnapshotNode): boolean {
  const normalized = normalizeNodeKind(node);
  return normalized.includes('application') || normalized.includes('window');
}

function areRelatedSnapshotNodes(
  left: RawSnapshotNode,
  right: RawSnapshotNode,
  byIndex: Map<number, RawSnapshotNode>,
): boolean {
  return isSnapshotAncestor(left, right, byIndex) || isSnapshotAncestor(right, left, byIndex);
}

function isSnapshotAncestor(
  ancestor: RawSnapshotNode,
  node: RawSnapshotNode,
  byIndex: Map<number, RawSnapshotNode>,
): boolean {
  let current = typeof node.parentIndex === 'number' ? byIndex.get(node.parentIndex) : undefined;
  const visited = new Set<number>();
  while (current && !visited.has(current.index)) {
    if (current.index === ancestor.index) return true;
    visited.add(current.index);
    current =
      typeof current.parentIndex === 'number' ? byIndex.get(current.parentIndex) : undefined;
  }
  return false;
}

function validRect(rect: RawSnapshotNode['rect']): Rect | null {
  if (!rect) return null;
  if (
    !Number.isFinite(rect.x) ||
    !Number.isFinite(rect.y) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height)
  ) {
    return null;
  }
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function areRectsApproximatelyEqual(left: Rect, right: Rect): boolean {
  const tolerance = 0.5;
  return (
    Math.abs(left.x - right.x) <= tolerance &&
    Math.abs(left.y - right.y) <= tolerance &&
    Math.abs(left.width - right.width) <= tolerance &&
    Math.abs(left.height - right.height) <= tolerance
  );
}

function mergeCoveredHint(hints: string[] | undefined): string[] {
  return Array.from(new Set([...(hints ?? []), COVERED_PRESENTATION_HINT]));
}
