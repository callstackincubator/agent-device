import type { CommandFlags } from '../../core/dispatch.ts';
import {
  centerOfRect,
  findNodeByRef,
  normalizeRef,
  type Rect,
  type SnapshotNode,
} from '../../utils/snapshot.ts';
import { findNearestHittableAncestor, findNodeByLabel } from '../snapshot-processing.ts';
import type { SessionStore } from '../session-store.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import type { CaptureSnapshotForSession } from './interaction-snapshot.ts';
import type { ContextFromFlags } from './interaction-common.ts';
import {
  isNodeVisibleInEffectiveViewport,
  resolveEffectiveViewportRect,
} from '../../utils/mobile-snapshot-semantics.ts';

export type ResolveRefTarget = typeof resolveRefTarget;

export function parseCoordinateTarget(positionals: string[]): { x: number; y: number } | null {
  if (positionals.length < 2) return null;
  const x = Number(positionals[0]);
  const y = Number(positionals[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function resolveRefTarget(params: {
  session: SessionState;
  refInput: string;
  fallbackLabel: string;
  requireRect: boolean;
  invalidRefMessage: string;
  notFoundMessage: string;
}):
  | { ok: true; target: { ref: string; node: SnapshotNode; snapshotNodes: SnapshotNode[] } }
  | { ok: false; response: DaemonResponse } {
  const { session, refInput, fallbackLabel, requireRect, invalidRefMessage, notFoundMessage } =
    params;
  if (!session.snapshot) {
    return {
      ok: false,
      response: {
        ok: false,
        error: { code: 'INVALID_ARGS', message: 'No snapshot in session. Run snapshot first.' },
      },
    };
  }
  const ref = normalizeRef(refInput);
  if (!ref) {
    return {
      ok: false,
      response: { ok: false, error: { code: 'INVALID_ARGS', message: invalidRefMessage } },
    };
  }
  let node = findNodeByRef(session.snapshot.nodes, ref);
  if ((!node || (requireRect && !node.rect)) && fallbackLabel.length > 0) {
    node = findNodeByLabel(session.snapshot.nodes, fallbackLabel);
  }
  if (!node || (requireRect && !node.rect)) {
    return {
      ok: false,
      response: { ok: false, error: { code: 'COMMAND_FAILED', message: notFoundMessage } },
    };
  }
  return { ok: true, target: { ref, node, snapshotNodes: session.snapshot.nodes } };
}

export function resolveRectCenter(rect: Rect | undefined): { x: number; y: number } | null {
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

export async function resolveRefTargetWithRectRefresh(params: {
  session: SessionState;
  refInput: string;
  fallbackLabel: string;
  commandLabel: string;
  promoteToHittableAncestor: boolean;
  invalidRefMessage: string;
  missingBoundsMessage: string;
  invalidBoundsMessage: string;
  reqFlags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
  resolveRefTarget: ResolveRefTarget;
}): Promise<
  | {
      ok: true;
      target: {
        ref: string;
        node: SnapshotNode;
        snapshotNodes: SnapshotNode[];
        point: { x: number; y: number };
      };
    }
  | { ok: false; response: DaemonResponse }
> {
  const {
    session,
    refInput,
    fallbackLabel,
    commandLabel,
    promoteToHittableAncestor,
    invalidRefMessage,
    missingBoundsMessage,
    invalidBoundsMessage,
    reqFlags,
    sessionStore,
    contextFromFlags,
    captureSnapshotForSession,
    resolveRefTarget,
  } = params;
  const resolvedRefTarget = resolveRefTarget({
    session,
    refInput,
    fallbackLabel,
    requireRect: true,
    invalidRefMessage,
    notFoundMessage: missingBoundsMessage,
  });
  if (!resolvedRefTarget.ok) return { ok: false, response: resolvedRefTarget.response };

  const { ref } = resolvedRefTarget.target;
  let node = promoteToHittableAncestor
    ? resolveActionableTouchNode(
        resolvedRefTarget.target.snapshotNodes,
        resolvedRefTarget.target.node,
      )
    : resolvedRefTarget.target.node;
  let snapshotNodes = resolvedRefTarget.target.snapshotNodes;
  let point = resolveRectCenter(node.rect);

  if (!point) {
    const refreshed = await captureSnapshotForSession(
      session,
      reqFlags,
      sessionStore,
      contextFromFlags,
      { interactiveOnly: true },
    );
    const refNode = findNodeByRef(refreshed.nodes, ref);
    const fallbackNode =
      fallbackLabel.length > 0 ? findNodeByLabel(refreshed.nodes, fallbackLabel) : null;
    const resolvedRefNode =
      refNode && promoteToHittableAncestor
        ? resolveActionableTouchNode(refreshed.nodes, refNode)
        : refNode;
    const resolvedFallbackNode =
      fallbackNode && promoteToHittableAncestor
        ? resolveActionableTouchNode(refreshed.nodes, fallbackNode)
        : fallbackNode;
    const fallbackNodePoint = resolveRectCenter(resolvedFallbackNode?.rect);
    const refNodePoint = resolveRectCenter(resolvedRefNode?.rect);
    const refreshedNode = refNodePoint
      ? resolvedRefNode
      : fallbackNodePoint
        ? resolvedFallbackNode
        : (resolvedRefNode ?? resolvedFallbackNode);
    const refreshedPoint = resolveRectCenter(refreshedNode?.rect);
    if (refreshedNode && refreshedPoint) {
      node = refreshedNode;
      snapshotNodes = refreshed.nodes;
      point = refreshedPoint;
    }
  }

  if (!point) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: invalidBoundsMessage,
        },
      },
    };
  }

  const viewport = node.rect ? resolveEffectiveViewportRect(node, snapshotNodes) : null;
  if (node.rect && viewport && !isNodeVisibleInEffectiveViewport(node, snapshotNodes)) {
    return {
      ok: false,
      response: {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: `Ref ${refInput} is off-screen and not safe to ${commandLabel}`,
          hint: `Run scrollintoview ${refInput}, then retry ${commandLabel} with the returned currentRef or a fresh snapshot.`,
          details: {
            reason: 'offscreen_ref',
            ref,
            rect: node.rect,
            viewport,
          },
        },
      },
    };
  }

  return { ok: true, target: { ref, node, snapshotNodes, point } };
}

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

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function pickLargestRect(rects: Rect[]): Rect | null {
  let bestRect: Rect | null = null;
  let bestArea = -1;
  for (const rect of rects) {
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestRect = rect;
      bestArea = area;
    }
  }
  return bestRect;
}
