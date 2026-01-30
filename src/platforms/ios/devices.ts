import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

export async function listIosDevices(): Promise<DeviceInfo[]> {
  if (process.platform !== 'darwin') {
    throw new AppError('UNSUPPORTED_PLATFORM', 'iOS tools are only available on macOS');
  }

  const simctlAvailable = await whichCmd('xcrun');
  if (!simctlAvailable) {
    throw new AppError('TOOL_MISSING', 'xcrun not found in PATH');
  }

  const devices: DeviceInfo[] = [];

  const simResult = await runCmd('xcrun', ['simctl', 'list', 'devices', '-j']);
  try {
    const payload = JSON.parse(simResult.stdout as string) as {
      devices: Record<
        string,
        { name: string; udid: string; state: string; isAvailable: boolean }[]
      >;
    };
    for (const runtimes of Object.values(payload.devices)) {
      for (const device of runtimes) {
        if (!device.isAvailable) continue;
        devices.push({
          platform: 'ios',
          id: device.udid,
          name: device.name,
          kind: 'simulator',
          booted: device.state === 'Booted',
        });
      }
    }
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'Failed to parse simctl devices JSON', undefined, err);
  }

  const devicectlAvailable = await whichCmd('xcrun');
  if (devicectlAvailable) {
    try {
      const result = await runCmd('xcrun', ['devicectl', 'list', 'devices', '--json']);
      const payload = JSON.parse(result.stdout as string) as {
        devices: { identifier: string; name: string; platform: string }[];
      };
      for (const device of payload.devices ?? []) {
        if (device.platform?.toLowerCase().includes('ios')) {
          devices.push({
            platform: 'ios',
            id: device.identifier,
            name: device.name,
            kind: 'device',
            booted: true,
          });
        }
      }
    } catch {
      // Ignore devicectl failures; simulators are still supported.
    }
  }

  return devices;
}
