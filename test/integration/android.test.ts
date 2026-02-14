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

  const nodes = Array.isArray(snapshot.json?.data?.nodes) ? (snapshot.json.data.nodes as SnapshotNode[]) : [];
  const clickTarget = selectSettingsClickTarget(nodes);
  integration.assertResult(
    Boolean(clickTarget),
    'select click target',
    snapshotArgs,
    snapshot,
    { detail: 'expected at least one bounded, labeled node with a ref in snapshot output' },
  );
  if (!clickTarget) return;

  const clickArgs = ['click', asRefArg(clickTarget.ref), '--json', ...session];
  integration.runStep(`click ${clickTarget.label ?? clickTarget.ref}`, clickArgs);

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

type SnapshotNode = {
  ref?: string;
  label?: string;
  rect?: { width?: number; height?: number };
};

function selectSettingsClickTarget(nodes: SnapshotNode[]): SnapshotNode | null {
  const clickableNodes = nodes.filter((node) => {
    const ref = typeof node.ref === 'string' ? node.ref.trim() : '';
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    const width = node.rect?.width;
    const height = node.rect?.height;
    return (
      ref.length > 0 &&
      label.length > 0 &&
      label !== '(no-label)' &&
      typeof width === 'number' &&
      width > 0 &&
      typeof height === 'number' &&
      height > 0
    );
  });
  if (clickableNodes.length === 0) return null;

  const preferredLabels = [
    'Apps',
    'Apps & notifications',
    'Network & internet',
    'Connected devices',
    'Display',
    'Battery',
    'Notifications',
  ];
  const preferred = clickableNodes.find((node) => {
    const label = String(node.label ?? '').toLowerCase();
    return preferredLabels.some((candidate) => label.includes(candidate.toLowerCase()));
  });
  return preferred ?? clickableNodes[0] ?? null;
}

function asRefArg(ref: string | undefined): string {
  const normalized = String(ref ?? '').trim();
  return normalized.startsWith('@') ? normalized : `@${normalized}`;
}
