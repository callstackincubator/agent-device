import type { Rect, SnapshotNode } from '../utils/snapshot.ts';
import { centerOfRect } from '../utils/snapshot.ts';
import { containsPoint, pickLargestRect } from '../utils/rect-visibility.ts';
import { findNearestHittableAncestor } from '../daemon/snapshot-processing.ts';

export function resolveActionableTouchNode(
  nodes: SnapshotNode[],
  node: SnapshotNode,
): SnapshotNode {
  const descendant = findPreferredActionableDescendant(nodes, node);
  if (descendant?.rect && resolveRectCenter(descendant.rect)) {
    return descendant;
  }
  const ancestor = findNearestHittableAncestor(nodes, node);
  if (ancestor?.rect && resolveRectCenter(ancestor.rect)) {
    if (isOverlyBroadAncestor(node, ancestor, nodes)) {
      return node;
    }
    return ancestor;
  }
  return node;
}

function resolveRectCenter(rect: Rect | undefined): { x: number; y: number } | null {
  const normalized = normalizeRect(rect);
  if (!normalized) return null;
  const center = centerOfRect(normalized);
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) return null;
  return center;
}

function normalizeRect(rect: Rect | undefined): Rect | null {
  if (!rect) return null;
  const x = Number(rect.x);
  const y = Number(rect.y);
  const width = Number(rect.width);
  const height = Number(rect.height);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height)
  ) {
    return null;
  }
  if (width < 0 || height < 0) return null;
  return { x, y, width, height };
}

function findPreferredActionableDescendant(
  nodes: SnapshotNode[],
  node: SnapshotNode,
): SnapshotNode | null {
  const targetRect = normalizeRect(node.rect);
  if (!targetRect) return null;

  let current = node;
  const visited = new Set<string>();
  while (!visited.has(current.ref)) {
    visited.add(current.ref);
    const sameRectChildren = nodes.filter((candidate) => {
      if (candidate.parentIndex !== current.index || !candidate.hittable) {
        return false;
      }
      const candidateRect = normalizeRect(candidate.rect);
      return candidateRect ? areRectsApproximatelyEqual(candidateRect, targetRect) : false;
    });
    if (sameRectChildren.length !== 1) {
      break;
    }
    current = sameRectChildren[0];
  }

  return current === node ? null : current;
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

function isOverlyBroadAncestor(
  node: SnapshotNode,
  ancestor: SnapshotNode,
  nodes: SnapshotNode[],
): boolean {
  const nodeRect = normalizeRect(node.rect);
  const ancestorRect = normalizeRect(ancestor.rect);
  if (!nodeRect || !ancestorRect) return false;
  const rootViewportRect = resolveRootViewportRect(nodes, nodeRect);
  if (!rootViewportRect) return false;
  if (!isRectViewportSized(ancestorRect, rootViewportRect)) return false;
  return !areRectsApproximatelyEqual(nodeRect, ancestorRect);
}

function resolveRootViewportRect(nodes: SnapshotNode[], targetRect: Rect): Rect | null {
  const targetCenter = centerOfRect(targetRect);
  const viewportRects = nodes
    .filter((node) => {
      const type = (node.type ?? '').toLowerCase();
      return type.includes('application') || type.includes('window');
    })
    .map((node) => normalizeRect(node.rect))
    .filter((rect): rect is Rect => rect !== null);
  if (viewportRects.length === 0) return null;

  const containingRects = viewportRects.filter((rect) =>
    containsPoint(rect, targetCenter.x, targetCenter.y),
  );
  return pickLargestRect(containingRects.length > 0 ? containingRects : viewportRects);
}

function isRectViewportSized(rect: Rect, viewportRect: Rect): boolean {
  const overlapArea = intersectionArea(rect, viewportRect);
  const rectArea = rect.width * rect.height;
  const viewportArea = viewportRect.width * viewportRect.height;
  if (overlapArea <= 0 || rectArea <= 0 || viewportArea <= 0) return false;

  const viewportCoverage = overlapArea / viewportArea;
  const rectCoverage = overlapArea / rectArea;
  return viewportCoverage >= 0.9 && rectCoverage >= 0.8;
}

function intersectionArea(left: Rect, right: Rect): number {
  const xOverlap = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const yOverlap = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return xOverlap * yOverlap;
}
