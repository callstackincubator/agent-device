import test from 'node:test';
import { createIntegrationTestContext, runCliJson } from './test-helpers.ts';

const session = ['--session', 'android-test'];

test.after(() => {
  runCliJson(['close', '--platform', 'android', ...session]);
});

test('android settings commands', () => {
  const integration = createIntegrationTestContext({
    platform: 'android',
    testName: 'android settings commands',
  });
  const openArgs = ['open', 'Settings', '--platform', 'android', '--json', ...session];
  integration.runStep('open settings', openArgs);

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  const snapshot = integration.runStep('snapshot', snapshotArgs);
  integration.assertResult(Array.isArray(snapshot.json?.data?.nodes), 'snapshot nodes', snapshotArgs, snapshot, {
    detail: 'expected snapshot to include a nodes array',
  });

  const clickAppsArgs = ['click', '@e13', '--json', ...session];
  integration.runStep('click apps', clickAppsArgs);

  const snapshotAppsArgs = ['snapshot', '-i', '--json', ...session];
  const snapshotApps = integration.runStep('snapshot apps', snapshotAppsArgs);
  integration.assertResult(
    Array.isArray(snapshotApps.json?.data?.nodes),
    'snapshot apps nodes',
    snapshotAppsArgs,
    snapshotApps,
    {
      detail: 'expected snapshot after click to include a nodes array',
    },
  );

  const backArgs = ['back', '--json', ...session];
  integration.runStep('back', backArgs);
});
