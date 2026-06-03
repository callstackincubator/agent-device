import type { DeviceInfo } from '../../utils/device.ts';
import { runHarmonyHdc } from './hdc.ts';

export type HarmonyLogOptions = {
  level?: 'D' | 'I' | 'W' | 'E' | 'F';
  tag?: string;
  clear?: boolean;
  lines?: number;
  signal?: AbortSignal;
};

export async function readHarmonyLogs(
  device: DeviceInfo,
  options?: HarmonyLogOptions,
): Promise<string> {
  if (options?.clear) {
    await runHarmonyHdc(device, ['shell', 'hilog', '-c'], { allowFailure: true });
  }

  const args = ['shell', 'hilog'];

  if (options?.lines) {
    args.push('-n', String(options.lines));
  }
  if (options?.level) {
    args.push('-L', options.level);
  }
  if (options?.tag) {
    args.push('-t', options.tag);
  }

  const result = await runHarmonyHdc(device, args, {
    allowFailure: false,
    timeoutMs: 10_000,
    signal: options?.signal,
  });

  return result.stdout;
}

export async function clearHarmonyLogs(device: DeviceInfo): Promise<void> {
  await runHarmonyHdc(device, ['shell', 'hilog', '-c'], { allowFailure: true });
}
