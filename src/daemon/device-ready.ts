import type { DeviceInfo } from '../utils/device.ts';

export async function ensureDeviceReady(device: DeviceInfo): Promise<void> {
  if (device.platform === 'ios' && device.kind === 'simulator') {
    const { ensureBootedSimulator } = await import('../platforms/ios/index.ts');
    await ensureBootedSimulator(device);
    return;
  }
  if (device.platform === 'android') {
    const { waitForAndroidBoot } = await import('../platforms/android/devices.ts');
    await waitForAndroidBoot(device.id);
  }
}
