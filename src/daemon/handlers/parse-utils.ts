export const POLL_INTERVAL_MS = 300;
export const DEFAULT_TIMEOUT_MS = 10_000;

export function parseTimeout(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
