export const ALERT_POLL_INTERVAL_MS = 300;
export const DEFAULT_ALERT_TIMEOUT_MS = 10_000;
export const ALERT_ACTION_RETRY_MS = 2_000;

export type AlertAction = 'get' | 'accept' | 'dismiss' | 'wait';

export type AlertPlatform = 'android' | 'ios' | 'macos';

export type AlertSource = 'permission' | 'native-dialog' | 'system-dialog';

export type AlertInfo = {
  title?: string;
  message?: string;
  buttons?: string[];
  platform?: AlertPlatform;
  source?: AlertSource;
  packageName?: string;
};
