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
