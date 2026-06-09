import type { DeviceInfo } from '../../utils/device.ts';
import { runHarmonyHdc } from './hdc.ts';

export type HarmonyPerfResult = {
  cpu?: string;
  memory?: string;
  processes?: string;
  raw?: Record<string, string>;
};

export async function measureHarmonyPerf(device: DeviceInfo): Promise<HarmonyPerfResult> {
  const result: HarmonyPerfResult = { raw: {} };

  // CPU info
  try {
    const cpuResult = await runHarmonyHdc(device, ['shell', 'hidumper', '-c', 'cpudump'], {
      allowFailure: true,
      timeoutMs: 10_000,
    });
    result.cpu = cpuResult.stdout;
    result.raw!.cpu = cpuResult.stdout;
  } catch {
    // CPU dump not available
  }

  // Memory info
  try {
    const memResult = await runHarmonyHdc(device, ['shell', 'hidumper', '-m'], {
      allowFailure: true,
      timeoutMs: 10_000,
    });
    result.memory = memResult.stdout;
    result.raw!.memory = memResult.stdout;
  } catch {
    // Memory dump not available
  }

  // Process list
  try {
    const psResult = await runHarmonyHdc(device, ['shell', 'ps', '-ef'], {
      allowFailure: true,
      timeoutMs: 10_000,
    });
    result.processes = psResult.stdout;
    result.raw!.processes = psResult.stdout;
  } catch {
    // Process list not available
  }

  return result;
}
