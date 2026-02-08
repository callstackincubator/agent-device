import test from 'node:test';
import assert from 'node:assert/strict';
import { formatResultDebug, runCliJson } from './test-helpers.ts';

const session = ['--session', 'android-test'];

test.after(() => {
  runCliJson(['close', '--platform', 'android', ...session]);
});

test('android settings commands', () => {
  const openArgs = ['open', 'Settings', '--platform', 'android', ...session];
  const open = runCliJson(openArgs);
  assert.equal(open.status, 0, formatResultDebug('open settings', openArgs, open));

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  const snapshot = runCliJson(snapshotArgs);
  assert.equal(snapshot.status, 0, formatResultDebug('snapshot', snapshotArgs, snapshot));
  assert.ok(
    Array.isArray(snapshot.json?.data?.nodes),
    formatResultDebug('snapshot nodes', snapshotArgs, snapshot),
  );

  const clickAppsArgs = ['click', '@e13', ...session];
  const clickApps = runCliJson(clickAppsArgs);
  assert.equal(clickApps.status, 0, formatResultDebug('click apps', clickAppsArgs, clickApps));

  const snapshotAppsArgs = ['snapshot', '-i', '--json', ...session];
  const snapshotApps = runCliJson(snapshotAppsArgs);
  assert.equal(
    snapshotApps.status,
    0,
    formatResultDebug('snapshot apps', snapshotAppsArgs, snapshotApps),
  );
  assert.ok(
    Array.isArray(snapshotApps.json?.data?.nodes),
    formatResultDebug('snapshot apps nodes', snapshotAppsArgs, snapshotApps),
  );

  const backArgs = ['back', ...session];
  const back = runCliJson(backArgs);
  assert.equal(back.status, 0, formatResultDebug('back', backArgs, back));
});
