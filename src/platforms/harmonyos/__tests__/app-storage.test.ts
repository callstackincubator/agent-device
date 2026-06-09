import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { harmonyDeviceForSerial } from '../hdc.ts';
import { clearHarmonyAppStorage } from '../app-lifecycle.ts';
import * as hdc from '../hdc.ts';

const DEVICE = harmonyDeviceForSerial('22M0223824043030');

afterEach(() => {
  vi.restoreAllMocks();
});

test('clearHarmonyAppStorage force-stops then bm clean data and cache', async () => {
  const runHarmonyHdc = vi.spyOn(hdc, 'runHarmonyHdc');
  runHarmonyHdc.mockResolvedValue({ exitCode: 0, stdout: 'ok', stderr: '' });

  const result = await clearHarmonyAppStorage(DEVICE, 'com.sdu.didi.hmos.psnger');

  assert.deepEqual(result, {
    bundleId: 'com.sdu.didi.hmos.psnger',
    clearedData: true,
    clearedCache: true,
  });
  assert.deepEqual(
    runHarmonyHdc.mock.calls.map(([_, args]) => args),
    [
      ['shell', 'aa', 'force-stop', 'com.sdu.didi.hmos.psnger'],
      ['shell', 'bm', 'clean', '-n', 'com.sdu.didi.hmos.psnger', '-d'],
      ['shell', 'bm', 'clean', '-n', 'com.sdu.didi.hmos.psnger', '-c'],
    ],
  );
});
