type GestureTimingSource = {
  recordingStartedAt: number;
  runnerStartedAtUptimeMs?: number;
  gestureStartUptimeMs?: number;
  fallbackStartedAtMs: number;
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
