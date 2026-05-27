import { emitDiagnostic } from '../utils/diagnostics.ts';
import type { SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { sleep } from '../utils/timeouts.ts';
import type { SessionState } from './types.ts';

const STABILIZATION_DEADLINE_MS = 1_500;
const STABILIZATION_INTERVAL_MS = 200;
const RECT_TOLERANCE_PX = 1;

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
  let previousSignature = buildStabilitySignature(previous.nodes);

  while (Date.now() - startedAt < STABILIZATION_DEADLINE_MS) {
    await sleep(STABILIZATION_INTERVAL_MS);
    attempts += 1;
    const current = await capture();
    const currentSignature = buildStabilitySignature(current.nodes);
    if (areSignaturesStable(previousSignature, currentSignature)) {
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

type StabilityEntry = {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

function buildStabilitySignature(nodes: SnapshotNode[]): StabilityEntry[] {
  const occurrenceCounts = new Map<string, number>();
  const entries: StabilityEntry[] = [];

  for (const node of nodes) {
    if (!node.rect) continue;
    if (!isFiniteRect(node.rect)) continue;
    if (isScrollIndicator(node)) continue;
    const semanticKey = [node.identifier, node.label, node.value, node.type]
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .join('|');
    if (!semanticKey.replaceAll('|', '')) continue;
    const occurrence = occurrenceCounts.get(semanticKey) ?? 0;
    occurrenceCounts.set(semanticKey, occurrence + 1);
    entries.push({
      key: `${semanticKey}|#${occurrence}`,
      x: node.rect.x,
      y: node.rect.y,
      width: node.rect.width,
      height: node.rect.height,
    });
  }

  return entries;
}

// fallow-ignore-next-line complexity
function areSignaturesStable(left: StabilityEntry[], right: StabilityEntry[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!a || !b || a.key !== b.key) return false;
    if (Math.abs(a.x - b.x) > RECT_TOLERANCE_PX) return false;
    if (Math.abs(a.y - b.y) > RECT_TOLERANCE_PX) return false;
    if (Math.abs(a.width - b.width) > RECT_TOLERANCE_PX) return false;
    if (Math.abs(a.height - b.height) > RECT_TOLERANCE_PX) return false;
  }
  return true;
}

function isFiniteRect(rect: NonNullable<SnapshotNode['rect']>): boolean {
  const values = [rect.x, rect.y, rect.width, rect.height];
  return values.every((value) => Number.isFinite(value)) && rect.width > 0 && rect.height > 0;
}

function isScrollIndicator(node: SnapshotNode): boolean {
  const label = `${node.label ?? ''} ${node.identifier ?? ''}`.toLowerCase();
  return label.includes('scroll bar');
}
