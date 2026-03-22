import test from 'node:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createIntegrationTestContext, runCliJson } from './test-helpers.ts';

const session = ['--session', 'macos-test'];
const macosTarget = ['--platform', 'macos'];

test.after(() => {
  runCliJson(['close', ...macosTarget, '--json', ...session]);
});

test('macos system settings commands', { skip: shouldSkipMacos() }, () => {
  const integration = createIntegrationTestContext({
    platform: 'macos',
    testName: 'macos system settings commands',
  });

  const openArgs = ['open', 'System Settings', ...macosTarget, '--json', ...session];
  integration.runStep('open system settings', openArgs);

  const outPath = path.resolve('test/screenshots/macos-system-settings.png');
  const shotArgs = ['screenshot', outPath, '--json', ...session];
  const shot = integration.runStep('screenshot system settings', shotArgs);
  integration.assertResult(existsSync(outPath), 'screenshot file missing', shotArgs, shot, {
    detail: `expected screenshot file at ${outPath}`,
  });

  const appStateArgs = ['appstate', '--json', ...session];
  const appState = integration.runStep('appstate', appStateArgs);
  integration.assertResult(
    appState.json?.data?.source === 'session',
    'appstate source is session',
    appStateArgs,
    appState,
    {
      detail: `expected appstate source=session, received ${JSON.stringify(appState.json?.data?.source)}`,
    },
  );
  integration.assertResult(
    appState.json?.data?.appBundleId === 'com.apple.systempreferences',
    'appstate bundle id is system settings',
    appStateArgs,
    appState,
    {
      detail: `expected appstate bundle id com.apple.systempreferences, received ${JSON.stringify(appState.json?.data?.appBundleId)}`,
    },
  );

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  let snapshot = integration.runStep('snapshot', snapshotArgs);
  integration.assertResult(
    Array.isArray(snapshot.json?.data?.nodes),
    'snapshot nodes',
    snapshotArgs,
    snapshot,
    {
      detail: 'expected snapshot to include a nodes array',
    },
  );

  const generalSidebarRef = findSnapshotNodeRef(
    snapshot,
    (node) => node?.type === 'Cell' && node?.label === 'General',
  );
  integration.assertResult(
    typeof generalSidebarRef === 'string',
    'general sidebar ref exists',
    snapshotArgs,
    snapshot,
    {
      detail: 'expected snapshot to include a sidebar cell for General',
    },
  );

  const openGeneralArgs = ['click', generalSidebarRef as string, '--json', ...session];
  const openGeneral = integration.runStep('open general section', openGeneralArgs);
  integration.assertResult(
    openGeneral.json?.success,
    'open general section success',
    openGeneralArgs,
    openGeneral,
    {
      detail: 'expected clicking the General sidebar cell ref to return success=true',
    },
  );

  snapshot = integration.runStep('snapshot after general', snapshotArgs);
  const aboutButtonRef = findSnapshotNodeRef(
    snapshot,
    (node) => node?.type === 'Button' && node?.label === 'About',
  );
  integration.assertResult(
    typeof aboutButtonRef === 'string',
    'about button visible in general view',
    snapshotArgs,
    snapshot,
    { detail: 'expected General view snapshot to include an About button' },
  );

  const clickAboutArgs = ['click', aboutButtonRef as string, '--json', ...session];
  const clickAbout = integration.runStep('click about', clickAboutArgs);
  integration.assertResult(
    clickAbout.json?.success,
    'click about success',
    clickAboutArgs,
    clickAbout,
    { detail: 'expected clicking the About button ref to return success=true' },
  );

  const snapshotAfterAbout = integration.runStep('snapshot after about', snapshotArgs);
  integration.assertResult(
    snapshotHasIdentifierEnabledState(snapshotAfterAbout, 'go back', true),
    'back control enabled after about navigation',
    snapshotArgs,
    snapshotAfterAbout,
    { detail: 'expected macOS back control to be enabled after opening About' },
  );

  const backArgs = ['back', '--json', ...session];
  const back = integration.runStep('back', backArgs);
  integration.assertResult(back.json?.success, 'back success', backArgs, back, {
    detail: 'expected back to return success=true on macOS',
  });

  const snapshotAfterBack = integration.runStep('snapshot after back', snapshotArgs);
  integration.assertResult(
    snapshotHasLabel(snapshotAfterBack, 'About'),
    'about option visible after returning',
    snapshotArgs,
    snapshotAfterBack,
    { detail: 'expected About to be visible again after navigating back from About' },
  );
});

function shouldSkipMacos(): boolean {
  return process.platform !== 'darwin';
}

function snapshotHasIdentifierEnabledState(
  result: ReturnType<typeof runCliJson>,
  identifier: string,
  enabled: boolean,
): boolean {
  const nodes = Array.isArray(result.json?.data?.nodes) ? result.json.data.nodes : [];
  return nodes.some((node: { identifier?: string; enabled?: boolean }) => {
    return node?.identifier === identifier && node?.enabled === enabled;
  });
}

function snapshotHasLabel(result: ReturnType<typeof runCliJson>, label: string): boolean {
  const nodes = Array.isArray(result.json?.data?.nodes) ? result.json.data.nodes : [];
  return nodes.some((node: { label?: string }) => node?.label === label);
}

function findSnapshotNodeRef(
  result: ReturnType<typeof runCliJson>,
  predicate: (node: { type?: string; label?: string; ref?: string }) => boolean,
): string | null {
  const nodes = Array.isArray(result.json?.data?.nodes) ? result.json.data.nodes : [];
  const match = nodes.find((node: { type?: string; label?: string; ref?: string }) =>
    predicate(node),
  );
  return typeof match?.ref === 'string' ? `@${match.ref}` : null;
}
