import type { SnapshotState } from '../utils/snapshot.ts';
import type { SessionState } from './types.ts';

// How long after a navigation-sensitive action (press, click, back, open) to consider
// the Android UI hierarchy potentially stale.  Android's UIAutomator dump is async
// and can lag behind real transitions by up to ~2 s; 2.5 s gives a comfortable margin
// while avoiding unnecessary retries for steady-state interactions like typing.
const ANDROID_FRESHNESS_WINDOW_MS = 2_500;

// Progressive back-off delays between freshness retry attempts.  Two retries at
// 250 ms + 400 ms cover the vast majority of Android transition latencies without
// adding perceptible lag to the happy path.
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
  // Route-stuck recovery only makes sense against a baseline captured in a broad, comparable
  // shape. Interactive/scoped/depth-limited snapshots are still useful for users, but they are
  // too pruned to serve as a reliable "same route vs new route" baseline.
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
  // Keep this set intentionally narrow. `type`, `fill`, and generic `swipe` happen far more
  // often than real route changes, so marking freshness for them would add retry latency to
  // common steady-state loops. We only opt in commands that regularly move to a new screen.
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

// A snapshot whose node count dropped to ≤20% of the previous capture is likely a
// stale or mid-transition dump.  The 12-node floor prevents false positives on
// already-tiny trees where fluctuation is normal.
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
  // Trees smaller than 12 nodes are too small for meaningful route comparison —
  // minor UI updates can produce high overlap percentages by coincidence.
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
  // Consider the snapshot "stuck" when ≥90% of nodes are identical and the number of
  // additions/removals stays within 15% (or at least 3).  These thresholds accommodate
  // minor dynamic content (clocks, counters) while still detecting genuine route changes.
  const toleratedDelta = Math.max(3, Math.floor(total * 0.15));
  return (
    unchanged >= Math.floor(total * 0.9) &&
    additions <= toleratedDelta &&
    removals <= toleratedDelta
  );
}
