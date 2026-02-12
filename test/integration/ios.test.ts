import test from 'node:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createIntegrationTestContext, runCliJson } from './test-helpers.ts';

const session = ['--session', 'ios-test'];

test.after(() => {
  runCliJson(['close', '--platform', 'ios', '--json', ...session]);
});

test('ios settings commands', { skip: shouldSkipIos() }, async () => {
  const integration = createIntegrationTestContext({
    platform: 'ios',
    testName: 'ios settings commands',
  });
  const openArgs = ['open', 'com.apple.Preferences', '--platform', 'ios', '--json', ...session];
  integration.runStep('open settings', openArgs);

  const outPath = path.resolve('test/screenshots/ios-settings.png');
  const shotArgs = ['screenshot', outPath, '--platform', 'ios', '--json', ...session];
  const shot = integration.runStep('screenshot settings', shotArgs);
  integration.assertResult(existsSync(outPath), 'screenshot file missing', shotArgs, shot, {
    detail: `expected screenshot file at ${outPath}`,
  });

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  const snapshot = integration.runStep('snapshot', snapshotArgs);
  integration.assertResult(Array.isArray(snapshot.json?.data?.nodes), 'snapshot nodes', snapshotArgs, snapshot, {
    detail: 'expected snapshot to include a nodes array',
  });

  const clickArgs = ['click', '@e21', '--json', ...session];
  integration.runStep('click @e21', clickArgs);

  const snapshotGeneralArgs = ['snapshot', '--json', ...session];
  const snapshotGeneral = integration.runStep('snapshot general', snapshotGeneralArgs);
  const generalDescription = 'Manage your overall setup and preferences';
  const generalNodes = Array.isArray(snapshotGeneral.json?.data?.nodes)
    ? snapshotGeneral.json.data.nodes
    : [];
  integration.assertResult(
    generalNodes.some(
      (node: { label?: string }) =>
        typeof node?.label === 'string' && node.label.includes(generalDescription),
    ),
    'snapshot shows general page description',
    snapshotGeneralArgs,
    snapshotGeneral,
    {
      detail: `expected a node label containing ${JSON.stringify(generalDescription)}`,
    },
  );

  const findTextArgs = ['find', 'text', generalDescription, 'exists', '--json', ...session];
  const findText = integration.runStep('find text', findTextArgs);
  integration.assertResult(
    findText.json?.success,
    'find text success',
    findTextArgs,
    findText,
    { detail: 'expected find command to return success=true' },
  );

  const backArgs = ['back', '--json', ...session];
  integration.runStep('back', backArgs);
});

function shouldSkipIos(): boolean {
  return process.platform !== 'darwin';
}
