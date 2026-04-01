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
