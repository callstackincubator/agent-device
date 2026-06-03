import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

const { mockRunIosRunnerCommand } = vi.hoisted(() => ({
  mockRunIosRunnerCommand: vi.fn(),
}));

vi.mock('../../platforms/ios/runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/runner-client.ts')>();
  return { ...actual, runIosRunnerCommand: mockRunIosRunnerCommand };
});

import {
  handlePanCommand,
  handleRotateGestureCommand,
  handleSwipeCommand,
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

beforeEach(() => {
  mockRunIosRunnerCommand.mockReset();
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

  assert.deepEqual(calls, [[340, 520, 60, 520, 300]]);
  assert.deepEqual(result, {
    x1: 340,
    y1: 520,
    x2: 60,
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

test('handleSwipeCommand preserves iOS swipe duration through dispatch', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    swipe: async (...args: unknown[]) => {
      calls.push(args);
    },
  };

  const result = await handleSwipeCommand(
    IOS_SIMULATOR,
    interactor,
    ['100', '200', '180', '200', '300'],
    undefined,
  );

  assert.deepEqual(calls, [[100, 200, 180, 200, 300]]);
  assert.deepEqual(result, {
    x1: 100,
    y1: 200,
    x2: 180,
    y2: 200,
    durationMs: 300,
    effectiveDurationMs: 300,
    timingMode: 'direct',
    count: 1,
    pauseMs: 0,
    pattern: 'one-way',
    message: 'Swiped',
  });
});

test('handleSwipeCommand uses synthesized iOS runner drag series for repeated swipes', async () => {
  mockRunIosRunnerCommand.mockResolvedValueOnce({
    gestureStartUptimeMs: 100,
    gestureEndUptimeMs: 720,
  });
  const interactor = makeUnusedInteractor();

  const result = await handleSwipeCommand(
    IOS_SIMULATOR,
    interactor,
    ['100', '650', '100', '450', '120'],
    {
      count: 2,
      pauseMs: 50,
      pattern: 'ping-pong',
      appBundleId: 'com.example.App',
    },
  );

  assert.deepEqual(mockRunIosRunnerCommand.mock.calls[0]?.[1], {
    command: 'dragSeries',
    x: 100,
    y: 650,
    x2: 100,
    y2: 450,
    durationMs: 120,
    count: 2,
    pauseMs: 50,
    pattern: 'ping-pong',
    synthesized: true,
    appBundleId: 'com.example.App',
  });
  assert.equal(result.timingMode, 'runner-series');
  assert.equal(result.message, 'Swiped 2 times (ping-pong)');
});

test('handlePanCommand preserves interactor result metadata', async () => {
  const calls: unknown[][] = [];
  const interactor = {
    ...makeUnusedInteractor(),
    pan: async (...args: unknown[]) => {
      calls.push(args);
      return { backend: 'xctest' };
    },
  };

  const result = await handlePanCommand(interactor, ['196', '122', '80', '0', '500']);

  assert.deepEqual(calls, [[196, 122, 276, 122, 500]]);
  assert.deepEqual(result, {
    x: 196,
    y: 122,
    dx: 80,
    dy: 0,
    x2: 276,
    y2: 122,
    durationMs: 500,
    backend: 'xctest',
    message: 'Panned (196, 122) by (80, 0)',
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
