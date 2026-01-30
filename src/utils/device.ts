import { AppError } from './errors.ts';
import { isInteractive } from './interactive.ts';
import { isCancel, select } from '@clack/prompts';

export type Platform = 'ios' | 'android';
export type DeviceKind = 'simulator' | 'emulator' | 'device';

export type DeviceInfo = {
  platform: Platform;
  id: string;
  name: string;
  kind: DeviceKind;
  booted?: boolean;
};

export type DeviceSelector = {
  platform?: Platform;
  deviceName?: string;
  udid?: string;
  serial?: string;
};

export async function selectDevice(
  devices: DeviceInfo[],
  selector: DeviceSelector,
): Promise<DeviceInfo> {
  let candidates = devices;
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  if (selector.platform) {
    candidates = candidates.filter((d) => d.platform === selector.platform);
  }

  if (selector.udid) {
    const match = candidates.find((d) => d.id === selector.udid && d.platform === 'ios');
    if (!match) throw new AppError('DEVICE_NOT_FOUND', `No iOS device with UDID ${selector.udid}`);
    return match;
  }

  if (selector.serial) {
    const match = candidates.find((d) => d.id === selector.serial && d.platform === 'android');
    if (!match)
      throw new AppError('DEVICE_NOT_FOUND', `No Android device with serial ${selector.serial}`);
    return match;
  }

  if (selector.deviceName) {
    const target = normalize(selector.deviceName);
    const match = candidates.find((d) => normalize(d.name) === target);
    if (!match) {
      throw new AppError('DEVICE_NOT_FOUND', `No device named ${selector.deviceName}`);
    }
    return match;
  }

  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0) {
    throw new AppError('DEVICE_NOT_FOUND', 'No devices found', { selector });
  }

  const booted = candidates.filter((d) => d.booted);
  if (booted.length === 1) return booted[0];

  if (isInteractive()) {
    const choice = await select({
      message: 'Multiple devices available. Choose a device to continue:',
      options: (booted.length > 0 ? booted : candidates).map((device) => ({
        label: `${device.name} (${device.platform}${device.kind ? `, ${device.kind}` : ''}${device.booted ? ', booted' : ''})`,
        value: device.id,
      })),
    });
    if (isCancel(choice)) {
      throw new AppError('INVALID_ARGS', 'Device selection cancelled');
    }
    if (choice) {
      const match = candidates.find((d) => d.id === choice);
      if (match) return match;
    }
  }

  return booted[0] ?? candidates[0];
}
