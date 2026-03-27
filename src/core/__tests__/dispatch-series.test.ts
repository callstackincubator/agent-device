import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  requireIntInRange,
  clampIosSwipeDuration,
  shouldUseIosTapSeries,
  shouldUseIosDragSeries,
  computeDeterministicJitter,
  runRepeatedSeries,
} from '../dispatch-series.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const iosDevice: DeviceInfo = { platform: 'ios', id: 'test', name: 'iPhone', kind: 'simulator' };
const androidDevice: DeviceInfo = {
  platform: 'android',
  id: 'test',
  name: 'Pixel',
  kind: 'emulator',
};

// --- requireIntInRange ---

test('requireIntInRange returns value at lower bound', () => {
  assert.equal(requireIntInRange(0, 'x', 0, 10), 0);
});

test('requireIntInRange returns value at upper bound', () => {
  assert.equal(requireIntInRange(10, 'x', 0, 10), 10);
});

test('requireIntInRange returns value within range', () => {
  assert.equal(requireIntInRange(5, 'x', 0, 10), 5);
});

test('requireIntInRange throws for value below minimum', () => {
  assert.throws(
    () => requireIntInRange(-1, 'x', 0, 10),
    (e: unknown) => e instanceof AppError && e.code === 'INVALID_ARGS',
  );
});

test('requireIntInRange throws for value above maximum', () => {
  assert.throws(
    () => requireIntInRange(11, 'x', 0, 10),
    (e: unknown) => e instanceof AppError && e.code === 'INVALID_ARGS',
  );
});

test('requireIntInRange throws for non-integer value', () => {
  assert.throws(
    () => requireIntInRange(5.5, 'x', 0, 10),
    (e: unknown) => e instanceof AppError && e.code === 'INVALID_ARGS',
  );
});

test('requireIntInRange throws for non-finite values', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.throws(
      () => requireIntInRange(value, 'x', 0, 10),
      (e: unknown) => e instanceof AppError && e.code === 'INVALID_ARGS',
    );
  }
});

// --- clampIosSwipeDuration ---

test('clampIosSwipeDuration returns value within bounds unchanged', () => {
  assert.equal(clampIosSwipeDuration(30), 30);
});

test('clampIosSwipeDuration clamps below-minimum to 16', () => {
  assert.equal(clampIosSwipeDuration(5), 16);
});

test('clampIosSwipeDuration clamps above-maximum to 60', () => {
  assert.equal(clampIosSwipeDuration(100), 60);
});

test('clampIosSwipeDuration returns exact boundary values unchanged', () => {
  assert.equal(clampIosSwipeDuration(16), 16);
  assert.equal(clampIosSwipeDuration(60), 60);
});

test('clampIosSwipeDuration rounds fractional input before clamping', () => {
  assert.equal(clampIosSwipeDuration(30.4), 30);
  assert.equal(clampIosSwipeDuration(15.6), 16);
});

// --- shouldUseIosTapSeries ---

test('shouldUseIosTapSeries returns true for iOS with count > 1 and no hold or jitter', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 2, 0, 0), true);
});

test('shouldUseIosTapSeries returns false for Android', () => {
  assert.equal(shouldUseIosTapSeries(androidDevice, 2, 0, 0), false);
});

test('shouldUseIosTapSeries returns false when count is 1', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 1, 0, 0), false);
});

test('shouldUseIosTapSeries returns false when holdMs is non-zero', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 2, 100, 0), false);
});

test('shouldUseIosTapSeries returns false when jitterPx is non-zero', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 2, 0, 5), false);
});

// --- shouldUseIosDragSeries ---

test('shouldUseIosDragSeries returns true for iOS with count > 1', () => {
  assert.equal(shouldUseIosDragSeries(iosDevice, 2), true);
});

test('shouldUseIosDragSeries returns false for Android', () => {
  assert.equal(shouldUseIosDragSeries(androidDevice, 2), false);
});

test('shouldUseIosDragSeries returns false when count is 1', () => {
  assert.equal(shouldUseIosDragSeries(iosDevice, 1), false);
});

// --- computeDeterministicJitter ---

test('computeDeterministicJitter scales pattern entry by jitter pixels', () => {
  assert.deepEqual(computeDeterministicJitter(1, 3), [3, 0]);
});

test('computeDeterministicJitter returns [0, 0] at index 0', () => {
  assert.deepEqual(computeDeterministicJitter(0, 5), [0, 0]);
});

test('computeDeterministicJitter cycles through 9-entry pattern', () => {
  assert.deepEqual(computeDeterministicJitter(9, 2), [0, 0]);
});

test('computeDeterministicJitter returns [0, 0] when jitterPx is 0', () => {
  assert.deepEqual(computeDeterministicJitter(1, 0), [0, 0]);
});

test('computeDeterministicJitter returns [0, 0] when jitterPx is negative', () => {
  assert.deepEqual(computeDeterministicJitter(1, -3), [0, 0]);
});

// --- runRepeatedSeries ---

test('runRepeatedSeries invokes operation for each index in order', async () => {
  const indices: number[] = [];
  await runRepeatedSeries(4, 0, async (i) => {
    indices.push(i);
  });
  assert.deepEqual(indices, [0, 1, 2, 3]);
});

test('runRepeatedSeries does not invoke operation when count is 0', async () => {
  const indices: number[] = [];
  await runRepeatedSeries(0, 0, async (i) => {
    indices.push(i);
  });
  assert.deepEqual(indices, []);
});

test('runRepeatedSeries pauses between operations but not after the last', async () => {
  const timeoutDelays: number[] = [];
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((cb: () => void, ms: number) => {
    timeoutDelays.push(ms);
    cb();
    return 0;
  }) as typeof setTimeout);
  const pauseMs = 50;
  const calls: number[] = [];
  await runRepeatedSeries(3, pauseMs, async (i) => {
    calls.push(i);
  });
  assert.deepEqual(calls, [0, 1, 2]);
  // 3 operations with pauses only between them = 2 pauses
  assert.deepEqual(timeoutDelays, [pauseMs, pauseMs]);
});

test('runRepeatedSeries propagates operation error and stops iteration', async () => {
  const indices: number[] = [];
  await assert.rejects(
    () =>
      runRepeatedSeries(5, 0, async (i) => {
        indices.push(i);
        if (i === 2) throw new Error('boom');
      }),
    (e: unknown) => e instanceof Error && e.message === 'boom',
  );
  assert.deepEqual(indices, [0, 1, 2]);
});
