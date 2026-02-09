import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { formatResultDebug, runCliJson } from './test-helpers.ts';

const session = ['--session', 'ios-test'];

test.after(() => {
  runCliJson(['close', '--platform', 'ios', '--json', ...session]);
});

test('ios settings commands', { skip: shouldSkipIos() }, async () => {
  const openArgs = ['open', 'com.apple.Preferences', '--platform', 'ios', '--json', ...session];
  const open = runCliJson(openArgs);
  assert.equal(open.status, 0, formatResultDebug('open settings', openArgs, open));

  const outPath = path.resolve('test/screenshots/ios-settings.png');
  const shotArgs = ['screenshot', outPath, '--platform', 'ios', '--json', ...session];
  const shot = runCliJson(shotArgs);
  assert.equal(shot.status, 0, formatResultDebug('screenshot settings', shotArgs, shot));
  assert.ok(existsSync(outPath), formatResultDebug('screenshot file missing', shotArgs, shot));

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  const snapshot = runCliJson(snapshotArgs);
  assert.equal(snapshot.status, 0, formatResultDebug('snapshot', snapshotArgs, snapshot));
  assert.ok(
    Array.isArray(snapshot.json?.data?.nodes),
    formatResultDebug('snapshot nodes', snapshotArgs, snapshot),
  );

  const clickArgs = ['click', '@e21', '--json', ...session];
  const click = runCliJson(clickArgs);
  assert.equal(click.status, 0, formatResultDebug('click @e13', clickArgs, click));

  const snapshotGeneral = runCliJson(['snapshot', '--json', ...session]);
  const generalDescription = 'Manage your overall setup and preferences';
  const generalNodes = Array.isArray(snapshotGeneral.json?.data?.nodes)
    ? snapshotGeneral.json.data.nodes
    : [];
  assert.ok(
    generalNodes.some(
      (node: { label?: string }) =>
        typeof node?.label === 'string' && node.label.includes(generalDescription),
    ),
    formatResultDebug('snapshot shows general page description', snapshotArgs, snapshotGeneral),
  );

  const findTextArgs = ['find', 'text', generalDescription, 'exists', '--json', ...session];
  const findText = runCliJson(findTextArgs);
  assert.equal(findText.status, 0, formatResultDebug('find text', findTextArgs, findText));
  assert.equal(
    findText.json?.success,
    true,
    formatResultDebug('find text success', findTextArgs, findText),
  );

  const backArgs = ['back', ...session];
  const back = runCliJson(backArgs);
  assert.equal(back.status, 0, formatResultDebug('back', backArgs, back));
});

function shouldSkipIos(): boolean {
  return process.platform !== 'darwin';
}
