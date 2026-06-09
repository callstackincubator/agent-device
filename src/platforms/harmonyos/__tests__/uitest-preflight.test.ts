import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  buildHarmonyUitestBlockedHint,
  findStuckHarmonyUitestProcess,
} from '../uitest-preflight.ts';

test('findStuckHarmonyUitestProcess detects uiRecord record', () => {
  const stuck = findStuckHarmonyUitestProcess([
    'shell 6151 1984 uitest uiRecord record',
    'shell 4253 1984 snapshot_display -f /data/local/tmp/x.jpeg',
  ]);
  assert.match(stuck ?? '', /uiRecord record/);
});

test('buildHarmonyUitestBlockedHint mentions reboot', () => {
  const hint = buildHarmonyUitestBlockedHint('shell 6151 uitest uiRecord record');
  assert.match(hint, /Reboot the device/i);
  assert.match(hint, /uiRecord record/i);
});
