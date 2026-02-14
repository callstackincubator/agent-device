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
  const clickTarget = selectSettingsClickSelector(nodes);
  integration.assertResult(
    Boolean(clickTarget),
    'select click target',
    snapshotArgs,
    snapshot,
    { detail: 'expected at least one bounded, labeled node in snapshot output' },
  );
  if (!clickTarget) return;

  const clickArgs = ['click', clickTarget.selector, '--json', ...session];
  integration.runStep(`click ${clickTarget.label}`, clickArgs);

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
  type?: string;
  label?: string;
  rect?: { width?: number; height?: number };
};

type SelectorTarget = {
  label: string;
  selector: string;
};

function selectSettingsClickSelector(nodes: SnapshotNode[]): SelectorTarget | null {
  const clickableNodes = nodes.filter((node) => {
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    const width = node.rect?.width;
    const height = node.rect?.height;
    return (
      label.length > 0 &&
      label !== '(no-label)' &&
      typeof width === 'number' &&
      width > 0 &&
      typeof height === 'number' &&
      height > 0
    );
  });
  if (clickableNodes.length === 0) return null;

  const labelCounts = new Map<string, number>();
  const roleLabelCounts = new Map<string, number>();
  for (const node of clickableNodes) {
    const labelKey = normalizeSelectorText(node.label);
    if (!labelKey) continue;
    labelCounts.set(labelKey, (labelCounts.get(labelKey) ?? 0) + 1);
    const roleKey = normalizeSelectorText(node.type) ?? '';
    const roleLabelKey = `${roleKey}::${labelKey}`;
    roleLabelCounts.set(roleLabelKey, (roleLabelCounts.get(roleLabelKey) ?? 0) + 1);
  }

  const preferredLabels = [
    'Apps',
    'Apps & notifications',
    'Network & internet',
    'Connected devices',
    'Display',
    'Battery',
    'Notifications',
  ];
  const preferredTargets = clickableNodes.filter((node) => {
    const label = normalizeSelectorText(node.label);
    if (!label) return false;
    return preferredLabels.some((candidate) => label.includes(candidate.toLowerCase()));
  });
  const candidates = preferredTargets.length > 0 ? preferredTargets : clickableNodes;
  const selected = candidates.find((node) => hasUniqueRoleAndLabel(node, labelCounts, roleLabelCounts))
    ?? candidates.find((node) => hasUniqueLabel(node, labelCounts))
    ?? candidates[0];
  if (!selected) return null;

  const selector = toSelectorExpression(selected, labelCounts, roleLabelCounts);
  if (!selector) return null;
  const label = String(selected.label ?? '').trim();
  return { label: label.length > 0 ? label : selector, selector };
}

function hasUniqueLabel(node: SnapshotNode, labelCounts: Map<string, number>): boolean {
  const labelKey = normalizeSelectorText(node.label);
  if (!labelKey) return false;
  return (labelCounts.get(labelKey) ?? 0) === 1;
}

function hasUniqueRoleAndLabel(
  node: SnapshotNode,
  labelCounts: Map<string, number>,
  roleLabelCounts: Map<string, number>,
): boolean {
  const labelKey = normalizeSelectorText(node.label);
  if (!labelKey) return false;
  const roleKey = normalizeSelectorText(node.type) ?? '';
  const roleLabelKey = `${roleKey}::${labelKey}`;
  if (roleKey.length === 0) return hasUniqueLabel(node, labelCounts);
  return (roleLabelCounts.get(roleLabelKey) ?? 0) === 1;
}

function toSelectorExpression(
  node: SnapshotNode,
  labelCounts: Map<string, number>,
  roleLabelCounts: Map<string, number>,
): string | null {
  const label = normalizeSelectorText(node.label);
  if (!label) return null;
  const role = normalizeSelectorText(node.type);
  if (role) {
    const roleLabelKey = `${role}::${label}`;
    if ((roleLabelCounts.get(roleLabelKey) ?? 0) === 1 || (labelCounts.get(label) ?? 0) > 1) {
      return `role=${JSON.stringify(role)} label=${JSON.stringify(label)}`;
    }
  }
  return `label=${JSON.stringify(label)}`;
}

function normalizeSelectorText(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized.length > 0 ? normalized : null;
}
