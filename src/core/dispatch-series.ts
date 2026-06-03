import { isApplePlatform, type DeviceInfo } from '../utils/device.ts';
import { sleep } from '../utils/timeouts.ts';
export { requireIntInRange } from '../utils/validation.ts';

const DETERMINISTIC_JITTER_PATTERN: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

export function shouldUseIosTapSeries(
  device: DeviceInfo,
  count: number,
  holdMs: number,
  jitterPx: number,
): boolean {
  return isApplePlatform(device.platform) && count > 1 && holdMs === 0 && jitterPx === 0;
}

export function shouldUseIosDragSeries(device: DeviceInfo, count: number): boolean {
  return isApplePlatform(device.platform) && count > 1;
}

export function shouldUseSynthesizedIosDrag(device: DeviceInfo): boolean {
  return device.platform === 'ios' && device.target !== 'tv';
}

export function computeDeterministicJitter(index: number, jitterPx: number): [number, number] {
  if (jitterPx <= 0) return [0, 0];
  const [dx, dy] = DETERMINISTIC_JITTER_PATTERN[index % DETERMINISTIC_JITTER_PATTERN.length]!;
  return [dx * jitterPx, dy * jitterPx];
}

export async function runRepeatedSeries(
  count: number,
  pauseMs: number,
  operation: (index: number) => Promise<void>,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    await operation(index);
    if (index < count - 1 && pauseMs > 0) {
      await sleep(pauseMs);
    }
  }
}
