import test from 'node:test';
import { createIntegrationTestContext, runCliJson } from './test-helpers.ts';

const session = ['--session', 'android-test'];
const settingsSectionLabels = [
  'Apps',
  'Apps & notifications',
  'Network & internet',
  'Network and internet',
  'Connected devices',
  'Display',
  'Battery',
  'Notifications',
  'Security',
  'Privacy',
];
const settingsSectionSelector = settingsSectionLabels
  .map((label) => (label.includes(' ') || label.includes('&') ? `label="${label}"` : `label=${label}`))
  .join(' || ');
const settingsCrashDialogLabels = ['Wait', 'Close app'];
const settingsCrashDialogSelector = settingsCrashDialogLabels
  .map((label) => (label.includes(' ') ? `label="${label}"` : `label=${label}`))
  .join(' || ');

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
  let snapshot = integration.runStep('snapshot', snapshotArgs);
  integration.assertResult(Array.isArray(snapshot.json?.data?.nodes), 'snapshot nodes', snapshotArgs, snapshot, {
    detail: 'expected snapshot to include a nodes array',
  });
  if (snapshotHasAnyLabel(snapshot, settingsCrashDialogLabels)) {
    const dismissCrashDialogArgs = ['click', settingsCrashDialogSelector, '--json', ...session];
    const dismissCrashDialog = integration.runStep(
      'dismiss settings crash dialog',
      dismissCrashDialogArgs,
    );
    integration.assertResult(
      dismissCrashDialog.json?.success,
      'dismiss settings crash dialog success',
      dismissCrashDialogArgs,
      dismissCrashDialog,
      { detail: 'expected click on crash dialog action to return success=true' },
    );
    integration.runStep('re-open settings after crash dialog', openArgs);
    snapshot = integration.runStep('snapshot after crash dialog', snapshotArgs);
    integration.assertResult(
      Array.isArray(snapshot.json?.data?.nodes),
      'snapshot after crash dialog nodes',
      snapshotArgs,
      snapshot,
      { detail: 'expected snapshot after crash dialog recovery to include a nodes array' },
    );
  }
  integration.assertResult(
    snapshotHasAnyLabel(snapshot, settingsSectionLabels),
    'snapshot contains settings section labels',
    snapshotArgs,
    snapshot,
    {
      detail: `expected snapshot to include one of ${JSON.stringify(settingsSectionLabels)}`,
    },
  );

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

function snapshotHasAnyLabel(
  result: ReturnType<typeof runCliJson>,
  candidateLabels: string[],
): boolean {
  const nodes = Array.isArray(result.json?.data?.nodes) ? result.json.data.nodes : [];
  return nodes.some((node: { label?: string }) => {
    const label = node?.label;
    if (typeof label !== 'string') return false;
    return candidateLabels.includes(label);
  });
}
