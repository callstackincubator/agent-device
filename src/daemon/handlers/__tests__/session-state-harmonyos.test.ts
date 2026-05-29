import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { harmonyDeviceForSerial } from '../../../platforms/harmonyos/hdc.ts';
import { handleSessionStateCommands } from '../session-state.ts';
import { SessionStore } from '../../session-store.ts';
import * as sessionDeviceUtils from '../session-device-utils.ts';
import * as harmonyAppLifecycle from '../../../platforms/harmonyos/app-lifecycle.ts';

vi.mock('../../../platforms/harmonyos/app-lifecycle.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../platforms/harmonyos/app-lifecycle.ts')>();
  return {
    ...actual,
    getHarmonyAppState: vi.fn(),
  };
});

const getHarmonyAppState = vi.mocked(harmonyAppLifecycle.getHarmonyAppState);
const HARMONY_DEVICE = harmonyDeviceForSerial('22M0223824043030');

afterEach(() => {
  vi.restoreAllMocks();
});

test('appstate uses hdc aa dump for harmonyos instead of adb', async () => {
  getHarmonyAppState.mockResolvedValue({
    bundleId: 'com.xiaojukeji.didi',
    state: 'foreground',
  });
  vi.spyOn(sessionDeviceUtils, 'resolveCommandDevice').mockResolvedValue(HARMONY_DEVICE);

  const response = await handleSessionStateCommands({
    req: {
      command: 'appstate',
      positionals: [],
      flags: { platform: 'harmonyos', device: HARMONY_DEVICE.id },
    },
    sessionName: '',
    sessionStore: new SessionStore('/tmp/agent-device-test-sessions'),
  });

  assert.ok(response?.ok);
  assert.equal(response?.data?.platform, 'harmonyos');
  assert.equal(response?.data?.appBundleId, 'com.xiaojukeji.didi');
  assert.equal(getHarmonyAppState.mock.calls.length, 1);
});
