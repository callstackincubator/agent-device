export function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Alias for `resolveTimeoutMs` — semantically marks the caller expects seconds. */
export function resolveTimeoutSeconds(
  raw: string | undefined,
  fallback: number,
  min: number,
): number {
  return resolveTimeoutMs(raw, fallback, min);
}
