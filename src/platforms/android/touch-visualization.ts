import { runCmd } from '../../utils/exec.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { adbArgs } from './adb.ts';

export async function readAndroidShowTouchesSetting(device: DeviceInfo): Promise<string | null> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'settings', 'get', 'system', 'show_touches']), {
    allowFailure: true,
  });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  if (!value || value.toLowerCase() === 'null') return null;
  return value;
}

export async function setAndroidShowTouchesEnabled(
  device: DeviceInfo,
  enabled: boolean,
): Promise<void> {
  await runCmd(
    'adb',
    adbArgs(device, ['shell', 'settings', 'put', 'system', 'show_touches', enabled ? '1' : '0']),
  );
}

export async function restoreAndroidShowTouchesSetting(
  device: DeviceInfo,
  previousValue: string | null | undefined,
): Promise<void> {
  if (previousValue === undefined) return;
  if (previousValue === null) {
    await runCmd('adb', adbArgs(device, ['shell', 'settings', 'delete', 'system', 'show_touches']), {
      allowFailure: true,
    });
    return;
  }
  await runCmd('adb', adbArgs(device, ['shell', 'settings', 'put', 'system', 'show_touches', previousValue]), {
    allowFailure: true,
  });
}
