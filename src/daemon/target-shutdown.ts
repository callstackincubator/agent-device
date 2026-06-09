import { runAndroidAdb } from '../platforms/android/adb.ts';
import { shutdownSimulator } from '../platforms/ios/simulator.ts';
import type { DeviceInfo } from '../utils/device.ts';
import { normalizeError } from '../utils/errors.ts';

export type DeviceTargetShutdownResult = {
  success: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: ReturnType<typeof normalizeError>;
};

export function canShutdownDeviceTarget(device: DeviceInfo): boolean {
  return isIosSimulator(device) || isAndroidEmulator(device);
}

export async function shutdownDeviceTarget(
  device: DeviceInfo,
): Promise<DeviceTargetShutdownResult> {
  try {
    return isIosSimulator(device)
      ? await shutdownSimulator(device)
      : await shutdownAndroidEmulator(device);
  } catch (error) {
    const normalized = normalizeError(error);
    return {
      success: false,
      exitCode: -1,
      stdout: '',
      stderr: normalized.message,
      error: normalized,
    };
  }
}

function isIosSimulator(device: DeviceInfo): boolean {
  return device.platform === 'ios' && device.kind === 'simulator';
}

function isAndroidEmulator(device: DeviceInfo): boolean {
  return device.platform === 'android' && device.kind === 'emulator';
}

async function shutdownAndroidEmulator(device: DeviceInfo): Promise<DeviceTargetShutdownResult> {
  const result = await runAndroidAdb(device, ['emu', 'kill'], {
    allowFailure: true,
    timeoutMs: 15_000,
  });
  return {
    success: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
  };
}
