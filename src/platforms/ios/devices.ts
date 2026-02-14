import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

  let jsonPath: string | null = null;
  try {
    jsonPath = path.join(
      os.tmpdir(),
      `agent-device-devicectl-${process.pid}-${Date.now()}.json`,
    );
    await runCmd('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath]);
    const jsonText = await fs.readFile(jsonPath, 'utf8');
    const payload = JSON.parse(jsonText) as {
      result?: {
        devices?: Array<{
          identifier?: string;
          name?: string;
          hardwareProperties?: { platform?: string; udid?: string };
          deviceProperties?: { name?: string };
          connectionProperties?: { tunnelState?: string };
        }>;
      };
    };
    for (const device of payload.result?.devices ?? []) {
      const platform = device.hardwareProperties?.platform ?? '';
      if (platform.toLowerCase().includes('ios')) {
        const id = device.hardwareProperties?.udid ?? device.identifier ?? '';
        const name = device.name ?? device.deviceProperties?.name ?? id;
        if (!id) continue;
        devices.push({
          platform: 'ios',
          id,
          name,
          kind: 'device',
          booted: true,
        });
      }
    }
  } catch {
    // Ignore devicectl failures; simulators are still supported.
  } finally {
    if (jsonPath) {
      await fs.rm(jsonPath, { force: true }).catch(() => {});
    }
  }

  return devices;
}
