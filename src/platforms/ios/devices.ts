import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const IOS_DEVICECTL_LIST_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_DEVICECTL_LIST_TIMEOUT_MS,
  8_000,
  500,
);

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
    const devicectlResult = await runCmd('xcrun', ['devicectl', 'list', 'devices', '--json-output', jsonPath], {
      allowFailure: true,
      timeoutMs: IOS_DEVICECTL_LIST_TIMEOUT_MS,
    });
    if (devicectlResult.exitCode !== 0) {
      return devices;
    }
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

function resolveTimeoutMs(raw: string | undefined, fallback: number, min: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.floor(parsed));
}
