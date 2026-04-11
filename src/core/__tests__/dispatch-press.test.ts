import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand, shouldUseIosDragSeries, shouldUseIosTapSeries } from '../dispatch.ts';
import {
  IOS_SIMULATOR,
  ANDROID_EMULATOR,
  MACOS_DEVICE,
} from '../../__tests__/test-utils/device-fixtures.ts';

vi.mock('../../platforms/ios/macos-helper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/macos-helper.ts')>();
  return {
    ...actual,
    runMacOsPressAction: vi.fn(async () => ({})),
  };
});

import { runMacOsPressAction } from '../../platforms/ios/macos-helper.ts';

test('shouldUseIosTapSeries enables fast path for repeated plain iOS taps', () => {
  assert.equal(shouldUseIosTapSeries(IOS_SIMULATOR, 5, 0, 0), true);
});

test('shouldUseIosTapSeries disables fast path for single press or modified gestures', () => {
  assert.equal(shouldUseIosTapSeries(IOS_SIMULATOR, 1, 0, 0), false);
  assert.equal(shouldUseIosTapSeries(IOS_SIMULATOR, 5, 100, 0), false);
  assert.equal(shouldUseIosTapSeries(IOS_SIMULATOR, 5, 0, 1), false);
});

test('shouldUseIosTapSeries disables fast path for non-iOS devices', () => {
  assert.equal(shouldUseIosTapSeries(ANDROID_EMULATOR, 5, 0, 0), false);
});

test('shouldUseIosDragSeries enables fast path for repeated iOS swipes', () => {
  assert.equal(shouldUseIosDragSeries(IOS_SIMULATOR, 3), true);
});

test('shouldUseIosDragSeries disables fast path for single swipe and non-iOS', () => {
  assert.equal(shouldUseIosDragSeries(IOS_SIMULATOR, 1), false);
  assert.equal(shouldUseIosDragSeries(ANDROID_EMULATOR, 3), false);
});

test('dispatchCommand routes macOS menubar press through the helper', async () => {
  const mockRunMacOsPressAction = vi.mocked(runMacOsPressAction);
  mockRunMacOsPressAction.mockClear();

  const result = await dispatchCommand(MACOS_DEVICE, 'press', ['100', '200'], undefined, {
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
