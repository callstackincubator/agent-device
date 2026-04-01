import type { SnapshotState } from '../utils/snapshot.ts';
import type { SessionState } from './types.ts';

const ANDROID_FRESHNESS_WINDOW_MS = 2_500;

export const ANDROID_FRESHNESS_RETRY_DELAYS_MS = [250, 400] as const;

export type AndroidSnapshotFreshness = {
  action: string;
  markedAt: number;
  baselineCount: number;
  baselineSignatures?: string[];
  routeComparable: boolean;
};

export type AndroidFreshnessCaptureMeta = {
  action: string;
  retryCount: number;
  staleAfterRetries: boolean;
  reason?: 'empty-interactive' | 'sharp-drop' | 'stuck-route';
};

export function markAndroidSnapshotFreshness(
  session: SessionState,
  action: string,
  baseline = session.snapshot,
): void {
  if (session.device.platform !== 'android') return;
  const routeComparable = baseline?.comparisonSafe === true;
  session.androidSnapshotFreshness = {
    action,
    markedAt: Date.now(),
    baselineCount: baseline?.nodes.length ?? 0,
    baselineSignatures: routeComparable
      ? buildSnapshotSignatures(baseline?.nodes ?? [])
      : undefined,
    routeComparable,
  };
}

export function getActiveAndroidSnapshotFreshness(
  session: SessionState | undefined,
): AndroidSnapshotFreshness | undefined {
  if (!session || session.device.platform !== 'android') return undefined;
  const freshness = session.androidSnapshotFreshness;
  if (!freshness) return undefined;
  if (Date.now() - freshness.markedAt > ANDROID_FRESHNESS_WINDOW_MS) {
    delete session.androidSnapshotFreshness;
    return undefined;
  }
  return freshness;
}

export function clearAndroidSnapshotFreshness(session: SessionState | undefined): void {
  if (!session || session.device.platform !== 'android') return;
  delete session.androidSnapshotFreshness;
}

export function isNavigationSensitiveAction(command: string): boolean {
  return command === 'press' || command === 'click' || command === 'back' || command === 'open';
}

export function buildSnapshotSignatures(nodes: SnapshotState['nodes']): string[] {
  return nodes.map((node) =>
    [
      node.depth ?? 0,
      node.type ?? '',
      node.role ?? '',
      node.label ?? '',
      node.value ?? '',
      node.identifier ?? '',
      node.enabled === false ? 'disabled' : 'enabled',
      node.selected === true ? 'selected' : 'unselected',
      node.hittable === true ? 'hittable' : 'not-hittable',
    ].join('|'),
  );
}

export function isLikelyStaleSnapshotDrop(previousCount: number, currentCount: number): boolean {
  if (previousCount < 12) {
    return false;
  }
  return currentCount <= Math.floor(previousCount * 0.2);
}

export function isLikelySnapshotStuckOnPreviousRoute(
  previousSignatures: string[] | undefined,
  currentNodes: SnapshotState['nodes'],
): boolean {
  if (!previousSignatures || previousSignatures.length === 0) {
    return false;
  }
  const total = Math.max(previousSignatures.length, currentNodes.length);
  if (total < 12) {
    return false;
  }
  const currentSignatures = buildSnapshotSignatures(currentNodes);
  const comparableLength = Math.min(previousSignatures.length, currentSignatures.length);
  let unchanged = 0;
  for (let index = 0; index < comparableLength; index += 1) {
    if (previousSignatures[index] === currentSignatures[index]) {
      unchanged += 1;
    }
  }
  const additions = Math.max(0, currentSignatures.length - previousSignatures.length);
  const removals = Math.max(0, previousSignatures.length - currentSignatures.length);
  const toleratedDelta = Math.max(3, Math.floor(total * 0.15));
  return (
    unchanged >= Math.floor(total * 0.9) &&
    additions <= toleratedDelta &&
    removals <= toleratedDelta
  );
}
