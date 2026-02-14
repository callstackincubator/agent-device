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
  const openArgs = ['open', 'settings', '--platform', 'android', '--json', ...session];
  integration.runStep('open settings', openArgs);

  const appStateArgs = ['appstate', '--json', ...session];
  const appState = integration.runStep('appstate', appStateArgs);
  const openedPackage = String(appState.json?.data?.package ?? '').toLowerCase();
  integration.assertResult(
    openedPackage.includes('settings'),
    'appstate package is settings',
    appStateArgs,
    appState,
    {
      detail: `expected appstate package to include "settings", received ${JSON.stringify(appState.json?.data?.package)}`,
    },
  );

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  const snapshot = integration.runStep('snapshot', snapshotArgs);
  integration.assertResult(Array.isArray(snapshot.json?.data?.nodes), 'snapshot nodes', snapshotArgs, snapshot, {
    detail: 'expected snapshot to include a nodes array',
  });

  const settingsSectionSelector = [
    'label=Apps',
    'label="Apps & notifications"',
    'label="Network & internet"',
    'label="Connected devices"',
    'label=Display',
    'label=Battery',
    'label=Notifications',
  ].join(' || ');
  const clickArgs = ['click', settingsSectionSelector, '--json', ...session];
  const openSection = integration.runStep('open settings section', clickArgs);
  integration.assertResult(
    openSection.json?.success,
    'open settings section success',
    clickArgs,
    openSection,
    { detail: 'expected selector-based click to return success=true' },
  );

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

  const appStateAfterClick = integration.runStep('appstate after click', appStateArgs);
  const packageAfterClick = String(appStateAfterClick.json?.data?.package ?? '').toLowerCase();
  integration.assertResult(
    packageAfterClick.includes('settings'),
    'appstate after click package is settings',
    appStateArgs,
    appStateAfterClick,
    {
      detail: `expected appstate package after click to include "settings", received ${JSON.stringify(appStateAfterClick.json?.data?.package)}`,
    },
  );

  const backArgs = ['back', '--json', ...session];
  integration.runStep('back', backArgs);
});
