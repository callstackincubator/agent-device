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

  const openGeneralArgs = ['find', 'text', 'General', 'click', '--json', ...session];
  const openGeneral = integration.runStep('open general', openGeneralArgs);
  integration.assertResult(
    openGeneral.json?.success,
    'open general success',
    openGeneralArgs,
    openGeneral,
    { detail: 'expected find General click to return success=true' },
  );

  const snapshotGeneralArgs = ['snapshot', '--json', ...session];
  const snapshotGeneral = integration.runStep('snapshot general', snapshotGeneralArgs);
  const generalDescriptionCandidates = [
    'Manage your overall setup and preferences',
    'About',
    'Software Update',
  ];
  const generalNodes = Array.isArray(snapshotGeneral.json?.data?.nodes)
    ? snapshotGeneral.json.data.nodes
    : [];
  integration.assertResult(
    generalNodes.some((node: { label?: string }) => {
      const label = node?.label;
      if (typeof label !== 'string') return false;
      return generalDescriptionCandidates.some((candidate) => label.includes(candidate));
    }),
    'snapshot shows general page description',
    snapshotGeneralArgs,
    snapshotGeneral,
    {
      detail: `expected a node label containing one of ${JSON.stringify(generalDescriptionCandidates)}`,
    },
  );

  const findTextArgs = ['find', 'text', 'Software Update', 'exists', '--json', ...session];
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
