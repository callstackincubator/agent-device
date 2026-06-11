import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  requireIntInRange,
  shouldUseIosTapSeries,
  shouldUseIosDragSeries,
  shouldUseIosPressSequence,
  chunkRunnerSequenceSteps,
  chunkRunnerSequenceStepsByBudget,
} from '../dispatch-series.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const iosDevice: DeviceInfo = { platform: 'ios', id: 'test', name: 'iPhone', kind: 'simulator' };
const androidDevice: DeviceInfo = {
  platform: 'android',
  id: 'emu',
  name: 'Pixel',
  kind: 'emulator',
};
// --- requireIntInRange ---

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

// --- shouldUseIosTapSeries ---

test('shouldUseIosTapSeries returns true for iOS with count > 1 and no hold or jitter', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 2, 0, 0), true);
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

test('shouldUseIosDragSeries returns false when count is 1', () => {
  assert.equal(shouldUseIosDragSeries(iosDevice, 1), false);
});

// --- shouldUseIosPressSequence ---

test('shouldUseIosPressSequence returns true for iOS with count > 1 and hold', () => {
  assert.equal(shouldUseIosPressSequence(iosDevice, 3, 200, 0), true);
});

test('shouldUseIosPressSequence returns true for iOS with count > 1 and jitter', () => {
  assert.equal(shouldUseIosPressSequence(iosDevice, 3, 0, 2), true);
});

test('shouldUseIosPressSequence returns false without hold or jitter', () => {
  assert.equal(shouldUseIosPressSequence(iosDevice, 3, 0, 0), false);
});

test('shouldUseIosPressSequence returns false for count <= 1', () => {
  assert.equal(shouldUseIosPressSequence(iosDevice, 1, 200, 2), false);
});

test('shouldUseIosPressSequence returns false on non-Apple platforms', () => {
  assert.equal(shouldUseIosPressSequence(androidDevice, 3, 200, 2), false);
});

// --- chunkRunnerSequenceSteps ---

test('chunkRunnerSequenceSteps splits 45 steps into 20/20/5 preserving order', () => {
  const steps = Array.from({ length: 45 }, (_, index) => index);
  const chunks = chunkRunnerSequenceSteps(steps, 20);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [20, 20, 5],
  );
  assert.deepEqual(chunks.flat(), steps);
});

test('chunkRunnerSequenceSteps keeps a short list in one chunk', () => {
  const steps = [1, 2, 3];
  assert.deepEqual(chunkRunnerSequenceSteps(steps, 20), [steps]);
});

// --- chunkRunnerSequenceStepsByBudget ---

test('chunkRunnerSequenceStepsByBudget caps by step count when steps are cheap', () => {
  const steps = Array.from({ length: 45 }, () => ({}));
  const chunks = chunkRunnerSequenceStepsByBudget(steps, 20, 20_000);
  assert.deepEqual(
    chunks.map((chunk) => chunk.length),
    [20, 20, 5],
  );
});

test('chunkRunnerSequenceStepsByBudget splits below the step cap when holds exceed the budget', () => {
  // 20 holds of 2000ms each (+250ms overhead) ~= 45s -> must split despite count <= 20.
  const steps = Array.from({ length: 20 }, () => ({ durationMs: 2000 }));
  const chunks = chunkRunnerSequenceStepsByBudget(steps, 20, 20_000);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    const estimatedMs = chunk.reduce((sum, step) => sum + (step.durationMs ?? 0) + 250, 0);
    assert.ok(estimatedMs <= 20_000, `chunk estimated ${estimatedMs}ms exceeds budget`);
  }
  assert.equal(chunks.flat().length, 20);
});

test('chunkRunnerSequenceStepsByBudget keeps an oversized single step in its own chunk', () => {
  const steps = [{ durationMs: 10_000, pauseMs: 10_000 }, { durationMs: 100 }];
  const chunks = chunkRunnerSequenceStepsByBudget(steps, 20, 20_000);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]?.length, 1);
  assert.equal(chunks[1]?.length, 1);
});

// --- computeDeterministicJitter ---

// --- runRepeatedSeries ---
