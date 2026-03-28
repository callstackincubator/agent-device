import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { shouldUseIosDragSeries, shouldUseIosTapSeries } from '../dispatch.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { dispatchCommand } from '../dispatch.ts';

vi.mock('../../platforms/ios/macos-helper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/macos-helper.ts')>();
  return {
    ...actual,
    runMacOsPressAction: vi.fn(async () => ({})),
  };
});

import { runMacOsPressAction } from '../../platforms/ios/macos-helper.ts';

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

const macosDevice: DeviceInfo = {
  platform: 'macos',
  id: 'macos-1',
  name: 'Mac',
  kind: 'device',
  target: 'desktop',
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

test('dispatchCommand routes macOS menubar press through the helper', async () => {
  const mockRunMacOsPressAction = vi.mocked(runMacOsPressAction);
  mockRunMacOsPressAction.mockClear();

  const result = await dispatchCommand(macosDevice, 'press', ['100', '200'], undefined, {
    surface: 'menubar',
    appBundleId: 'com.example.menubarapp',
  });

  assert.deepEqual(result, {
    x: 100,
    y: 200,
    message: 'Tapped (100, 200)',
  });
  assert.equal(mockRunMacOsPressAction.mock.calls.length, 1);
  assert.deepEqual(mockRunMacOsPressAction.mock.calls[0], [
    100,
    200,
    { bundleId: 'com.example.menubarapp', surface: 'menubar' },
  ]);
});
