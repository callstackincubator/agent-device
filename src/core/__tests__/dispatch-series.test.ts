import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  requireIntInRange,
  clampIosSwipeDuration,
  shouldUseIosTapSeries,
  shouldUseIosDragSeries,
} from '../dispatch-series.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const iosDevice: DeviceInfo = { platform: 'ios', id: 'test', name: 'iPhone', kind: 'simulator' };
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

// --- computeDeterministicJitter ---

// --- runRepeatedSeries ---
