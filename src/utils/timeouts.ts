export function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}

/** Unit-agnostic alias for `resolveTimeoutMs`; use when the resolved value is not milliseconds (e.g. seconds). */
export const resolveTimeoutValue = resolveTimeoutMs;
