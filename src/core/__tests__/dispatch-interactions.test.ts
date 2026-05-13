import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { handlePressCommand } from '../dispatch-interactions.ts';
import type { Interactor } from '../interactors.ts';
import { MACOS_DEVICE } from '../../__tests__/test-utils/device-fixtures.ts';

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
    longPress: fail,
    focus: fail,
    type: fail,
    fill: fail,
    scroll: fail,
    screenshot: fail,
    back: fail,
    home: fail,
    rotate: fail,
    appSwitcher: fail,
    readClipboard: fail,
    writeClipboard: fail,
    setSetting: fail,
  };
}

test('handlePressCommand routes macOS menubar press through the helper', async () => {
  const mockRunMacOsPressAction = vi.mocked(runMacOsPressAction);
  mockRunMacOsPressAction.mockClear();

  const result = await handlePressCommand(
    MACOS_DEVICE,
    makeUnusedInteractor(),
    ['100', '200'],
    {
      surface: 'menubar',
      appBundleId: 'com.example.menubarapp',
    },
    {},
  );

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
