import {
  centerOfRect,
  findNodeByRef,
  normalizeRef,
  type Rect,
  type SnapshotNode,
} from '../../utils/snapshot.ts';
import { findNodeByLabel } from '../snapshot-processing.ts';
import type { DaemonResponse, SessionState } from '../types.ts';

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
