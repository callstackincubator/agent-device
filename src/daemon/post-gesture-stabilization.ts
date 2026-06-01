import { emitDiagnostic } from '../utils/diagnostics.ts';
import type { SnapshotState } from '../utils/snapshot.ts';
import { sleep } from '../utils/timeouts.ts';
import {
  areInteractionSurfaceSignaturesStable,
  buildInteractionSurfaceSignature,
} from './interaction-outcome-policy.ts';
import type { SessionState } from './types.ts';

const STABILIZATION_DEADLINE_MS = 1_500;
const STABILIZATION_INTERVAL_MS = 200;

export function markPostGestureStabilization(session: SessionState, action: string): void {
  if (!supportsPostGestureStabilization(session.device.platform)) return;
  if (!isPostGestureStabilizingAction(action)) return;
  session.postGestureStabilization = {
    action,
    markedAt: Date.now(),
  };
}

function clearPostGestureStabilization(session: SessionState | undefined): void {
  if (!session?.postGestureStabilization) return;
  session.postGestureStabilization = undefined;
}

export async function capturePostGestureStabilizedSnapshot(params: {
  session: SessionState | undefined;
  capture: () => Promise<SnapshotState>;
}): Promise<SnapshotState> {
  const { session, capture } = params;
  const pending = session?.postGestureStabilization;
  if (!session || !supportsPostGestureStabilization(session.device.platform) || !pending) {
    return await capture();
  }

  const startedAt = Date.now();
  let attempts = 1;
  let previous = await capture();
  let previousSignature = buildInteractionSurfaceSignature(previous.nodes);

  while (Date.now() - startedAt < STABILIZATION_DEADLINE_MS) {
    await sleep(STABILIZATION_INTERVAL_MS);
    attempts += 1;
    const current = await capture();
    const currentSignature = buildInteractionSurfaceSignature(current.nodes);
    if (areInteractionSurfaceSignaturesStable(previousSignature, currentSignature)) {
      clearPostGestureStabilization(session);
      emitDiagnostic({
        level: attempts > 2 ? 'info' : 'debug',
        phase: 'post_gesture_snapshot_stabilized',
        data: {
          action: pending.action,
          attempts,
          durationMs: Date.now() - startedAt,
        },
      });
      return current;
    }
    previous = current;
    previousSignature = currentSignature;
  }

  clearPostGestureStabilization(session);
  emitDiagnostic({
    level: 'warn',
    phase: 'post_gesture_snapshot_stabilization_timeout',
    data: {
      action: pending.action,
      attempts,
      durationMs: Date.now() - startedAt,
    },
  });
  return previous;
}

function isPostGestureStabilizingAction(action: string): boolean {
  return action === 'swipe' || action === 'scroll';
}

function supportsPostGestureStabilization(platform: SessionState['device']['platform']): boolean {
  return platform === 'ios' || platform === 'android';
}
