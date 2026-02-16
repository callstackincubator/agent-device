import { isEnvTruthy, TIMEOUT_PROFILES } from '../../utils/retry.ts';

export const IOS_BOOT_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_BOOT_TIMEOUT_MS,
  TIMEOUT_PROFILES.ios_boot.totalMs,
  5_000,
);

export const IOS_SIMCTL_LIST_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_SIMCTL_LIST_TIMEOUT_MS,
  TIMEOUT_PROFILES.ios_boot.operationMs,
  1_000,
);

export const IOS_APP_LAUNCH_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_APP_LAUNCH_TIMEOUT_MS,
  30_000,
  5_000,
);

export const IOS_DEVICECTL_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_DEVICECTL_TIMEOUT_MS,
  20_000,
  1_000,
);

export const RETRY_LOGS_ENABLED = isEnvTruthy(process.env.AGENT_DEVICE_RETRY_LOGS);

function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}
