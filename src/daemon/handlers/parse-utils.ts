export {
  ALERT_ACTION_RETRY_MS,
  ALERT_POLL_INTERVAL_MS as POLL_INTERVAL_MS,
  DEFAULT_ALERT_TIMEOUT_MS as DEFAULT_TIMEOUT_MS,
} from '../../alert-contract.ts';

export function parseTimeout(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
