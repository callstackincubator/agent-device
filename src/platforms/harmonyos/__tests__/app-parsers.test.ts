import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  lookupWukongLaunchAbility,
  parseHarmonyBundleList,
  parseHarmonyForegroundAbility,
  parseWukongAppInfo,
} from '../app-parsers.ts';

describe('HarmonyOS App Parsers', () => {
  describe('parseHarmonyBundleList', () => {
    it('parses empty output', () => {
      const result = parseHarmonyBundleList('');
      assert.deepEqual(result, []);
    });

    it('parses bundle names from bm dump output', () => {
      const output = `
Bundle Name: com.huawei.hmos.settings
Bundle Name: com.huawei.hmos.camera
Bundle Name: com.example.myapp
`;
      const result = parseHarmonyBundleList(output);
      assert.deepEqual(result, [
        'com.huawei.hmos.settings',
        'com.huawei.hmos.camera',
        'com.example.myapp',
      ]);
    });

    it('handles malformed output gracefully', () => {
      const output = 'some random output without bundle names';
      const result = parseHarmonyBundleList(output);
      assert.deepEqual(result, []);
    });
  });

  describe('parseWukongAppInfo', () => {
    it('parses bundle and ability pairs from wukong appinfo', () => {
      const output = `
I/O error : failed to load "/system/usr/ohos_locale_config/supported_locales.xml": Permission denied
BundleName:  com.sdu.didi.hmos.psnger
AbilityName:  EntryAbility
BundleName:  com.ss.dcar.auto
AbilityName:  DcarAbility
`;
      const map = parseWukongAppInfo(output);
      assert.strictEqual(map.get('com.sdu.didi.hmos.psnger'), 'EntryAbility');
      assert.strictEqual(map.get('com.ss.dcar.auto'), 'DcarAbility');
    });

    it('keeps the first ability when a bundle appears more than once', () => {
      const output = `
BundleName:  com.ohos.contacts
AbilityName:  com.ohos.contacts.EntryAbility
BundleName:  com.ohos.contacts
AbilityName:  com.ohos.contacts.MainAbility
`;
      assert.strictEqual(
        lookupWukongLaunchAbility(output, 'com.ohos.contacts'),
        'com.ohos.contacts.EntryAbility',
      );
    });
  });

  describe('parseHarmonyForegroundAbility', () => {
    it('returns null for empty output', () => {
      const result = parseHarmonyForegroundAbility('');
      assert.strictEqual(result, null);
    });

    it('parses foreground ability info', () => {
      const output = `
# app name [com.huawei.hmos.settings]
  main name [MainAbility]
  app state #FOREGROUND
`;
      const result = parseHarmonyForegroundAbility(output);
      assert.ok(result);
      assert.strictEqual(result?.bundleName, 'com.huawei.hmos.settings');
      assert.strictEqual(result?.abilityName, 'MainAbility');
    });

    it('returns null when no foreground ability', () => {
      const output = `
# app name [com.huawei.hmos.settings]
  app state #BACKGROUND
`;
      const result = parseHarmonyForegroundAbility(output);
      assert.strictEqual(result, null);
    });
  });
});
