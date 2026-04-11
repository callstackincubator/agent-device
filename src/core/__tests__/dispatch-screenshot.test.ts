import { test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { MACOS_DEVICE } from '../../__tests__/test-utils/device-fixtures.ts';

vi.mock('../../platforms/ios/macos-helper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/ios/macos-helper.ts')>();
  return {
    ...actual,
    runMacOsScreenshotAction: vi.fn(async () => ({})),
  };
});

import { runMacOsScreenshotAction } from '../../platforms/ios/macos-helper.ts';

test('dispatchCommand routes macOS menubar screenshots through the helper', async () => {
  const mockRunMacOsScreenshotAction = vi.mocked(runMacOsScreenshotAction);
  mockRunMacOsScreenshotAction.mockClear();

  const result = await dispatchCommand(
    MACOS_DEVICE,
    'screenshot',
    ['/tmp/menubar.png'],
    undefined,
    {
      surface: 'menubar',
      screenshotFullscreen: true,
    },
  );

  assert.deepEqual(result, {
    path: '/tmp/menubar.png',
    message: 'Saved screenshot: /tmp/menubar.png',
  });
  assert.equal(mockRunMacOsScreenshotAction.mock.calls.length, 1);
  assert.deepEqual(mockRunMacOsScreenshotAction.mock.calls[0], [
    '/tmp/menubar.png',
    { surface: 'menubar', fullscreen: true },
  ]);
});
