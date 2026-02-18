import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseIosDragSeries, shouldUseIosTapSeries } from '../dispatch.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const iosDevice: DeviceInfo = {
  platform: 'ios',
  id: 'ios-1',
  name: 'iPhone 15',
  kind: 'simulator',
  booted: true,
};

const androidDevice: DeviceInfo = {
  platform: 'android',
  id: 'android-1',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

test('shouldUseIosTapSeries enables fast path for repeated plain iOS taps', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 5, 0, 0), true);
});

test('shouldUseIosTapSeries disables fast path for single press or modified gestures', () => {
  assert.equal(shouldUseIosTapSeries(iosDevice, 1, 0, 0), false);
  assert.equal(shouldUseIosTapSeries(iosDevice, 5, 100, 0), false);
  assert.equal(shouldUseIosTapSeries(iosDevice, 5, 0, 1), false);
});

test('shouldUseIosTapSeries disables fast path for non-iOS devices', () => {
  assert.equal(shouldUseIosTapSeries(androidDevice, 5, 0, 0), false);
});

test('shouldUseIosDragSeries enables fast path for repeated iOS swipes', () => {
  assert.equal(shouldUseIosDragSeries(iosDevice, 3), true);
});

test('shouldUseIosDragSeries disables fast path for single swipe and non-iOS', () => {
  assert.equal(shouldUseIosDragSeries(iosDevice, 1), false);
  assert.equal(shouldUseIosDragSeries(androidDevice, 3), false);
});
