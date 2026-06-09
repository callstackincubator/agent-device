import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { harmonyDeviceForSerial } from '../hdc.ts';
import {
  clearHarmonyLaunchAbilityCache,
  getHarmonyLaunchAbilities,
  lookupHarmonyLaunchAbility,
} from '../launch-abilities.ts';
import * as hdc from '../hdc.ts';

const DEVICE = harmonyDeviceForSerial('22M0223824043030');

afterEach(() => {
  vi.restoreAllMocks();
  clearHarmonyLaunchAbilityCache();
});

test('getHarmonyLaunchAbilities parses wukong appinfo and caches per device', async () => {
  const runHarmonyHdc = vi.spyOn(hdc, 'runHarmonyHdc');
  runHarmonyHdc.mockResolvedValue({
    exitCode: 0,
    stdout: `
BundleName:  com.sdu.didi.hmos.psnger
AbilityName:  EntryAbility
BundleName:  com.ss.dcar.auto
AbilityName:  DcarAbility
`,
    stderr: '',
  });

  const first = await getHarmonyLaunchAbilities(DEVICE);
  const second = await getHarmonyLaunchAbilities(DEVICE);

  assert.equal(first.get('com.sdu.didi.hmos.psnger'), 'EntryAbility');
  assert.equal(first.get('com.ss.dcar.auto'), 'DcarAbility');
  assert.equal(runHarmonyHdc.mock.calls.length, 1);
  assert.equal(second.get('com.sdu.didi.hmos.psnger'), 'EntryAbility');
});

test('lookupHarmonyLaunchAbility returns null when bundle is missing', async () => {
  vi.spyOn(hdc, 'runHarmonyHdc').mockResolvedValue({
    exitCode: 0,
    stdout: 'BundleName:  com.example.app\nAbilityName:  EntryAbility\n',
    stderr: '',
  });

  assert.equal(await lookupHarmonyLaunchAbility(DEVICE, 'com.missing.app'), null);
});
