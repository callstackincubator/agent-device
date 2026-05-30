import { inferGestureReferenceFrame } from '../core/scroll-gesture.ts';
import type { SnapshotState } from '../utils/snapshot.ts';

export type TouchReferenceFrame = {
  referenceWidth: number;
  referenceHeight: number;
};

const snapshotReferenceFrameCache = new WeakMap<SnapshotState, TouchReferenceFrame>();

export function getSnapshotReferenceFrame(
  snapshot: SnapshotState | undefined,
): TouchReferenceFrame | undefined {
  if (!snapshot) return undefined;
  const cached = snapshotReferenceFrameCache.get(snapshot);
  if (cached) return cached;

  const inferred = inferTouchReferenceFrame(snapshot.nodes ?? []);
  if (!inferred) return undefined;
  snapshotReferenceFrameCache.set(snapshot, inferred);
  return inferred;
}

const inferTouchReferenceFrame = inferGestureReferenceFrame;
