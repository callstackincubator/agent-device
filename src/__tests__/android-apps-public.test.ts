import assert from 'node:assert/strict';
import { test } from 'vitest';

import {
  parseAndroidForegroundApp,
  parseAndroidLaunchablePackages,
  parseAndroidUserInstalledPackages,
} from '../android-apps.ts';

test('public android-apps entrypoint re-exports pure parsers', () => {
  assert.deepEqual(
    parseAndroidLaunchablePackages(
      [
        'com.google.android.apps.maps/.MainActivity',
        'org.mozilla.firefox/.App',
        'com.google.android.apps.maps/.MainActivity',
        '',
      ].join('\n'),
    ),
    ['com.google.android.apps.maps', 'org.mozilla.firefox'],
  );
  assert.deepEqual(
    parseAndroidUserInstalledPackages(
      ['package:com.google.android.apps.maps', 'package:org.mozilla.firefox', ''].join('\n'),
    ),
    ['com.google.android.apps.maps', 'org.mozilla.firefox'],
  );
  assert.deepEqual(parseAndroidUserInstalledPackages('package:com.example\nraw.package'), [
    'com.example',
    'raw.package',
  ]);
  assert.deepEqual(
    parseAndroidForegroundApp(
      [
        'mResumedActivity: ActivityRecord{123 u0 com.example.old/.OldActivity t1}',
        'mCurrentFocus=Window{17b u0 com.google.android.apps.maps/.MainActivity}',
      ].join('\n'),
    ),
    {
      package: 'com.google.android.apps.maps',
      activity: '.MainActivity',
    },
  );
  assert.deepEqual(
    parseAndroidForegroundApp(
      'mFocusedApp=AppWindowToken{17b token=Token{abc ActivityRecord{def u0 org.mozilla.firefox/.App t1}}}',
    ),
    {
      package: 'org.mozilla.firefox',
      activity: '.App',
    },
  );
  assert.deepEqual(
    parseAndroidForegroundApp(
      'mResumedActivity: ActivityRecord{123 u0 com.example.app/com.example.app.MainActivity t1}',
    ),
    {
      package: 'com.example.app',
      activity: 'com.example.app.MainActivity',
    },
  );
  assert.deepEqual(
    parseAndroidForegroundApp(
      'ResumedActivity: ActivityRecord{123 link=https://example.test/path u0 com.example.next/.NextActivity t1}',
    ),
    {
      package: 'com.example.next',
      activity: '.NextActivity',
    },
  );
  assert.equal(parseAndroidForegroundApp('mCurrentFocus=Window{17b u0 no component here}'), null);
  assert.equal(parseAndroidForegroundApp(''), null);
});
