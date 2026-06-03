import { whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { resolveHarmonyHdcExecutor } from './hdc-executor.ts';

export async function runHarmonyHdc(
  device: DeviceInfo,
  args: string[],
  options?: import('./hdc-executor.ts').HarmonyHdcExecutorOptions,
): Promise<import('./hdc-executor.ts').HarmonyHdcExecutorResult> {
  return await resolveHarmonyHdcExecutor(device)(args, options);
}

export function harmonyDeviceForSerial(serial: string): DeviceInfo {
  return {
    platform: 'harmonyos',
    id: serial,
    name: serial,
    kind: 'device',
    booted: true,
  };
}

export async function ensureHdc(): Promise<void> {
  const hdcAvailable = await whichCmd('hdc');
  if (!hdcAvailable) throw new AppError('TOOL_MISSING', 'hdc not found in PATH');
}
