import type { DeviceInfo } from '../utils/device.ts';

export function isIosSimulator(device: DeviceInfo): boolean {
  return device.platform === 'ios' && device.kind === 'simulator';
}

export function isAndroidEmulator(device: DeviceInfo): boolean {
  return device.platform === 'android' && device.kind === 'emulator';
}
