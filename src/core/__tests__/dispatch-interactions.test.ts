import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import {
  handleRotateGestureCommand,
  handleSwipePresetCommand,
  handleTransformGestureCommand,
} from '../dispatch-interactions.ts';
import type { Interactor } from '../interactor-types.ts';
import { ANDROID_EMULATOR, IOS_SIMULATOR } from '../../__tests__/test-utils/device-fixtures.ts';

vi.mock('../../platforms/ios/macos-helper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/macos-helper.ts')>();
  return {
    ...actual,
    runMacOsPressAction: vi.fn(async () => ({})),
  };
});

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
    pinch: fail,
    screenshot: fail,
    snapshot: fail,
    back: fail,
    home: fail,
    rotate: fail,
    rotateGesture: fail,
    transformGesture: fail,
    appSwitcher: fail,
    readClipboard: fail,
    writeClipboard: fail,
    setSetting: fail,
  };
}

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

test('handleSwipePresetCommand resolves Android in-page swipe to content lane', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    snapshot: async () => ({
      backend: 'android' as const,
      nodes: [
        {
          index: 0,
          type: 'application',
          rect: { x: 0, y: 0, width: 400, height: 800 },
        },
      ],
    }),
    swipe: async (...args: unknown[]) => {
      calls.push(args);
    },
  };

  const result = await handleSwipePresetCommand(
    ANDROID_EMULATOR,
    interactor,
    ['left', '300'],
    undefined,
  );

  assert.deepEqual(calls, [[360, 520, 40, 520, 300]]);
  assert.deepEqual(result, {
    x1: 360,
    y1: 520,
    x2: 40,
    y2: 520,
    preset: 'left',
    durationMs: 300,
    effectiveDurationMs: 300,
    timingMode: 'direct',
    count: 1,
    pauseMs: 0,
    pattern: 'one-way',
    message: 'Swiped left',
  });
});

test('handleRotateGestureCommand routes Android through the interactor', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    rotateGesture: async (...args: unknown[]) => {
      calls.push(args);
      return { backend: 'android-multitouch-helper' };
    },
  };

  const result = await handleRotateGestureCommand(ANDROID_EMULATOR, interactor, ['145']);

  assert.deepEqual(calls, [[145, undefined, undefined, 1]]);
  assert.deepEqual(result, {
    degrees: 145,
    velocity: 1,
    backend: 'android-multitouch-helper',
    message: 'Rotated gesture 145 degrees',
  });
});

test('handleTransformGestureCommand routes iOS simulator through the interactor', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    transformGesture: async (...args: unknown[]) => {
      calls.push(args);
      return { backend: 'xctest' };
    },
  };

  const result = await handleTransformGestureCommand(IOS_SIMULATOR, interactor, [
    '200',
    '420',
    '80',
    '-40',
    '2',
    '35',
  ]);

  assert.deepEqual(calls, [
    [{ x: 200, y: 420, dx: 80, dy: -40, scale: 2, degrees: 35, durationMs: undefined }],
  ]);
  assert.deepEqual(result, {
    x: 200,
    y: 420,
    dx: 80,
    dy: -40,
    scale: 2,
    degrees: 35,
    durationMs: undefined,
    backend: 'xctest',
    message: 'Requested transform gesture by (80, -40), scale 2, rotate 35 degrees',
  });
});
