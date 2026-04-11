import { test } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { dispatchCommand } from '../dispatch.ts';
import { ANDROID_EMULATOR } from '../../__tests__/test-utils/device-fixtures.ts';
import { withMockedAdb } from '../../__tests__/test-utils/mocked-binaries.ts';

test('dispatch back defaults to in-app mode and keeps Android back on keyevent 4', async () => {
  await withMockedAdb('agent-device-dispatch-back-modes-', async (argsLogPath) => {
    for (const backMode of [undefined, 'in-app', 'system'] as const) {
      const result = await dispatchCommand(ANDROID_EMULATOR, 'back', [], undefined, {
        backMode,
      });

      assert.equal(result?.action, 'back');
      assert.equal(result?.mode, backMode ?? 'in-app');
    }

    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, [
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'keyevent',
      '4',
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'keyevent',
      '4',
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'keyevent',
      '4',
    ]);
  });
});
