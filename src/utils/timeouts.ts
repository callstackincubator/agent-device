export function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

/** Alias for `resolveTimeoutMs` — semantically marks the caller expects seconds. */
export function resolveTimeoutSeconds(
  raw: string | undefined,
  fallback: number,
  min: number,
): number {
  return resolveTimeoutMs(raw, fallback, min);
}
