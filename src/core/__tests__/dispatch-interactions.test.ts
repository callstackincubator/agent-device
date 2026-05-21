import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  handleFlingCommand,
  handlePanCommand,
  handlePinchCommand,
  handlePressCommand,
  handleRotateGestureCommand,
} from '../dispatch-interactions.ts';
import type { Interactor } from '../interactor-types.ts';
import {
  ANDROID_EMULATOR,
  IOS_SIMULATOR,
  MACOS_DEVICE,
} from '../../__tests__/test-utils/device-fixtures.ts';
import { AppError } from '../../utils/errors.ts';

vi.mock('../../platforms/ios/macos-helper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/macos-helper.ts')>();
  return {
    ...actual,
    runMacOsPressAction: vi.fn(async () => ({})),
  };
});

import { runMacOsPressAction } from '../../platforms/ios/macos-helper.ts';

function makeUnusedInteractor(): Interactor {
  const fail = async () => {
    throw new Error('interactor should not be used for macOS menubar press');
  };
  return {
    open: fail,
    openDevice: fail,
    close: fail,
    tap: fail,
    doubleTap: fail,
    swipe: fail,
    pan: fail,
    fling: fail,
    longPress: fail,
    focus: fail,
    type: fail,
    fill: fail,
    scroll: fail,
    screenshot: fail,
    snapshot: fail,
    back: fail,
    home: fail,
    rotate: fail,
    rotateGesture: fail,
    appSwitcher: fail,
    readClipboard: fail,
    writeClipboard: fail,
    setSetting: fail,
  };
}

test('handlePressCommand routes macOS menubar press through the helper', async () => {
  const mockRunMacOsPressAction = vi.mocked(runMacOsPressAction);
  mockRunMacOsPressAction.mockClear();

  const result = await handlePressCommand(MACOS_DEVICE, makeUnusedInteractor(), ['100', '200'], {
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

test('handlePanCommand preserves the requested drag duration and moves by delta', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    pan: async (...args: unknown[]) => {
      calls.push(args);
    },
  };

  const result = await handlePanCommand(interactor, ['200', '420', '0', '-80', '500']);

  assert.deepEqual(calls, [[200, 420, 200, 340, 500]]);
  assert.deepEqual(result, {
    x: 200,
    y: 420,
    dx: 0,
    dy: -80,
    x2: 200,
    y2: 340,
    durationMs: 500,
    message: 'Panned (200, 420) by (0, -80)',
  });
});

test('handleFlingCommand converts direction and distance into a short drag', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    fling: async (...args: unknown[]) => {
      calls.push(args);
    },
  };

  const result = await handleFlingCommand(interactor, ['right', '200', '420', '180']);

  assert.deepEqual(calls, [[200, 420, 380, 420, 50]]);
  assert.deepEqual(result, {
    direction: 'right',
    x: 200,
    y: 420,
    x2: 380,
    y2: 420,
    distance: 180,
    durationMs: 50,
    message: 'Flung right',
  });
});

test('handlePinchCommand rejects Android adb sessions explicitly', async () => {
  await assert.rejects(
    () => handlePinchCommand(ANDROID_EMULATOR, ['2'], undefined),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'UNSUPPORTED_OPERATION' &&
      /Android adb sessions/i.test(error.message) &&
      /RemoteControl\/WebRTC/i.test(error.message),
  );
});

test('handleRotateGestureCommand defaults velocity sign to match degrees', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    rotateGesture: async (...args: unknown[]) => {
      calls.push(args);
    },
  };

  const result = await handleRotateGestureCommand(IOS_SIMULATOR, interactor, [
    '-215',
    '200',
    '420',
  ]);

  assert.deepEqual(calls, [[-215, 200, 420, -1]]);
  assert.deepEqual(result, {
    degrees: -215,
    x: 200,
    y: 420,
    velocity: -1,
    message: 'Rotated gesture -215 degrees',
  });
});

test('handleRotateGestureCommand rejects Android adb sessions explicitly', async () => {
  await assert.rejects(
    () => handleRotateGestureCommand(ANDROID_EMULATOR, makeUnusedInteractor(), ['145']),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'UNSUPPORTED_OPERATION' &&
      /Android adb sessions/i.test(error.message) &&
      /RemoteControl\/WebRTC/i.test(error.message),
  );
});
