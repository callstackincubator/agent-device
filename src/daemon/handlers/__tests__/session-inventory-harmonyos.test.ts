import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { harmonyDeviceForSerial } from '../../../platforms/harmonyos/hdc.ts';
import { handleSessionInventoryCommands } from '../session-inventory.ts';
import { SessionStore } from '../../session-store.ts';
import * as sessionDeviceUtils from '../session-device-utils.ts';
import * as harmonyAppLifecycle from '../../../platforms/harmonyos/app-lifecycle.ts';

vi.mock('../../../platforms/harmonyos/app-lifecycle.ts', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../platforms/harmonyos/app-lifecycle.ts')>();
  return {
    ...actual,
    listHarmonyApps: vi.fn(),
  };
});

const listHarmonyApps = vi.mocked(harmonyAppLifecycle.listHarmonyApps);
const HARMONY_DEVICE = harmonyDeviceForSerial('22M0223824043030');

beforeEach(() => {
  listHarmonyApps.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test('apps command lists HarmonyOS bundles via listHarmonyApps', async () => {
  listHarmonyApps.mockResolvedValue([
    {
      id: 'com.sdu.didi.hmos.psnger',
      name: 'psnger',
      bundleId: 'com.sdu.didi.hmos.psnger',
      activity: 'EntryAbility',
    },
  ]);
  vi.spyOn(sessionDeviceUtils, 'resolveCommandDevice').mockResolvedValue(HARMONY_DEVICE);

  const response = await handleSessionInventoryCommands({
    req: {
      command: 'apps',
      positionals: [],
      flags: { platform: 'harmonyos', device: HARMONY_DEVICE.id, appsFilter: 'user-installed' },
    },
    sessionName: '',
    sessionStore: new SessionStore('/tmp/agent-device-test-sessions'),
  });

  assert.ok(response?.ok);
  assert.deepEqual(response?.data?.apps, ['psnger (com.sdu.didi.hmos.psnger)']);
  assert.deepEqual(response?.data?.appDetails, [
    {
      id: 'com.sdu.didi.hmos.psnger',
      bundleId: 'com.sdu.didi.hmos.psnger',
      name: 'psnger',
      label: 'psnger (com.sdu.didi.hmos.psnger)',
      launchAbility: 'EntryAbility',
    },
  ]);
  assert.equal(listHarmonyApps.mock.calls.length, 1);
});
