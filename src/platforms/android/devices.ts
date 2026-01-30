import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) {
    throw new AppError('TOOL_MISSING', 'adb not found in PATH');
  }

  const result = await runCmd('adb', ['devices', '-l']);
  const lines = result.stdout.split('\n').map((l: string) => l.trim());
  const devices: DeviceInfo[] = [];

  for (const line of lines) {
    if (!line || line.startsWith('List of devices')) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (state !== 'device') continue;

    const modelPart = parts.find((p: string) => p.startsWith('model:')) ?? '';
    const rawModel = modelPart.replace('model:', '').replace(/_/g, ' ').trim();
    let name = rawModel || serial;

    if (serial.startsWith('emulator-')) {
      const avd = await runCmd('adb', ['-s', serial, 'emu', 'avd', 'name'], {
        allowFailure: true,
      });
      const avdName = (avd.stdout as string).trim();
      if (avd.exitCode === 0 && avdName) {
        name = avdName.replace(/_/g, ' ');
      }
    }

    const booted = await isAndroidBooted(serial);

    devices.push({
      platform: 'android',
      id: serial,
      name,
      kind: serial.startsWith('emulator-') ? 'emulator' : 'device',
      booted,
    });
  }

  return devices;
}

async function isAndroidBooted(serial: string): Promise<boolean> {
  try {
    const result = await runCmd('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      allowFailure: true,
    });
    return (result.stdout as string).trim() === '1';
  } catch {
    return false;
  }
}
