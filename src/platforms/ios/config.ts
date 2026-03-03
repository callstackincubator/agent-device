import { TIMEOUT_PROFILES } from '../../utils/retry.ts';
import { resolveTimeoutMs } from '../../utils/timeouts.ts';

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

export const IOS_SIMULATOR_SCREENSHOT_RETRY_MAX_ATTEMPTS = 5;
export const IOS_SIMULATOR_SCREENSHOT_RETRY_BASE_DELAY_MS = 1_000;
export const IOS_SIMULATOR_SCREENSHOT_RETRY_MAX_DELAY_MS = 5_000;
