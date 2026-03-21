type GestureTimingSource = {
  recordingStartedAt: number;
  runnerStartedAtUptimeMs?: number;
  gestureStartUptimeMs?: number;
  fallbackStartedAtMs: number;
};

type GestureDurationSource = {
  gestureStartUptimeMs?: number;
  gestureEndUptimeMs?: number;
  reportedDurationMs?: number;
  fallbackStartedAtMs: number;
  fallbackFinishedAtMs: number;
};

export function resolveGestureOffsetMs(source: GestureTimingSource): number {
  if (
    typeof source.runnerStartedAtUptimeMs === 'number' &&
    typeof source.gestureStartUptimeMs === 'number'
  ) {
    return Math.max(0, source.gestureStartUptimeMs - source.runnerStartedAtUptimeMs);
  }
  return Math.max(0, source.fallbackStartedAtMs - source.recordingStartedAt);
}

export function resolveGestureDurationMs(source: GestureDurationSource): number {
  if (
    typeof source.gestureStartUptimeMs === 'number' &&
    typeof source.gestureEndUptimeMs === 'number'
  ) {
    return Math.max(0, source.gestureEndUptimeMs - source.gestureStartUptimeMs);
  }
  if (typeof source.reportedDurationMs === 'number') {
    return Math.max(0, source.reportedDurationMs);
  }
  return Math.max(0, source.fallbackFinishedAtMs - source.fallbackStartedAtMs);
}
