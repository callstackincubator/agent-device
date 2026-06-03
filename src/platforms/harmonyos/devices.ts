import type { DeviceInfo, DeviceTarget } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { harmonyDeviceForSerial } from './hdc.ts';

export type HarmonyDeviceDiscoveryOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

export async function listHarmonyDevices(
  options?: HarmonyDeviceDiscoveryOptions,
): Promise<DeviceInfo[]> {
  const result = await runCmd('hdc', ['list', 'targets'], {
    allowFailure: true,
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 30_000,
  });

  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `hdc list targets failed: ${result.stderr}`);
  }

  const serials = parseHarmonyDeviceList(result.stdout);
  const devices: DeviceInfo[] = [];

  for (const serial of serials) {
    const device = await probeHarmonyDevice(serial);
    devices.push(device);
  }

  return devices;
}

export function parseHarmonyDeviceList(rawOutput: string): string[] {
  return rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '[Empty]');
}

async function probeHarmonyDevice(serial: string): Promise<DeviceInfo> {
  let target: DeviceTarget | undefined;

  try {
    const typeResult = await runCmd(
      'hdc',
      ['-t', serial, 'shell', 'param', 'get', 'const.build.characteristics'],
      { allowFailure: true, timeoutMs: 10_000 },
    );
    if (typeResult.exitCode === 0) {
      const characteristics = typeResult.stdout.trim().toLowerCase();
      if (characteristics.includes('tv')) {
        target = 'tv';
      }
    }
  } catch {
    // Default to mobile if probe fails
  }

  return {
    ...harmonyDeviceForSerial(serial),
    // Keep hdc target serial as the canonical selector (matches `hdc list targets`).
    name: serial,
    target: target ?? 'mobile',
  };
}

export async function isHarmonyDeviceBooted(serial: string): Promise<boolean> {
  try {
    const result = await runCmd(
      'hdc',
      ['-t', serial, 'shell', 'param', 'get', 'const.sys.boot_completed'],
      { allowFailure: true, timeoutMs: 5_000 },
    );
    return result.exitCode === 0 && result.stdout.trim() === 'true';
  } catch {
    return false;
  }
}
