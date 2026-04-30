import { whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { ensureAndroidSdkPathConfigured } from './sdk.ts';
import {
  resolveAndroidAdbExecutor,
  type AndroidAdbExecutorOptions,
  type AndroidAdbExecutorResult,
} from './adb-executor.ts';

export { sleep } from '../../utils/timeouts.ts';

export async function runAndroidAdb(
  device: DeviceInfo,
  args: string[],
  options?: AndroidAdbExecutorOptions,
): Promise<AndroidAdbExecutorResult> {
  return await resolveAndroidAdbExecutor(device)(args, options);
}

export function androidDeviceForSerial(deviceId: string): DeviceInfo {
  return {
    platform: 'android',
    id: deviceId,
    name: deviceId,
    kind: deviceId.startsWith('emulator-') ? 'emulator' : 'device',
    booted: true,
  };
}

export async function ensureAdb(): Promise<void> {
  await ensureAndroidSdkPathConfigured();
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) throw new AppError('TOOL_MISSING', 'adb not found in PATH');
}

export function isClipboardShellUnsupported(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return (
    haystack.includes('no shell command implementation') || haystack.includes('unknown command')
  );
}
