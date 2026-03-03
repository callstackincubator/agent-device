import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';

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

export function requireIntInRange(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
    throw new AppError('INVALID_ARGS', `${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function clampIosSwipeDuration(durationMs: number): number {
  // Keep iOS swipes stable while allowing explicit fast durations for scroll-heavy flows.
  return Math.min(60, Math.max(16, Math.round(durationMs)));
}

export function shouldUseIosTapSeries(
  device: DeviceInfo,
  count: number,
  holdMs: number,
  jitterPx: number,
): boolean {
  return device.platform === 'ios' && count > 1 && holdMs === 0 && jitterPx === 0;
}

export function shouldUseIosDragSeries(device: DeviceInfo, count: number): boolean {
  return device.platform === 'ios' && count > 1;
}

export function computeDeterministicJitter(index: number, jitterPx: number): [number, number] {
  if (jitterPx <= 0) return [0, 0];
  const [dx, dy] = DETERMINISTIC_JITTER_PATTERN[index % DETERMINISTIC_JITTER_PATTERN.length];
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
