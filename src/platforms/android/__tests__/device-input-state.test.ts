import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getAndroidKeyboardStatusWithAdb } from '../device-input-state.ts';
import type { AndroidAdbExecutor } from '../adb-executor.ts';

test('getAndroidKeyboardStatusWithAdb exposes active input method package', async () => {
  const adb: AndroidAdbExecutor = async (args) => {
    assert.deepEqual(args, ['shell', 'dumpsys', 'input_method']);
    return {
      stdout:
        'mInputShown=true mCurMethodId=com.google.android.inputmethod.latin/.LatinIME inputType=0x1',
      stderr: '',
      exitCode: 0,
    };
  };

  await assert.doesNotReject(async () => {
    const state = await getAndroidKeyboardStatusWithAdb(adb);
    assert.deepEqual(state, {
      visible: true,
      inputType: '0x1',
      type: 'text',
      inputMethodPackage: 'com.google.android.inputmethod.latin',
      focusedPackage: undefined,
      focusedResourceId: undefined,
      inputOwner: 'unknown',
    });
  });
});
