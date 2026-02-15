import test from 'node:test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createIntegrationTestContext, runCliJson } from './test-helpers.ts';

const session = ['--session', 'ios-test'];
const iosTarget = ['--platform', 'ios'];
const iosPhysicalUdid = process.env.IOS_UDID?.trim();
const runIosIntegrationOnCi = isEnvTruthy(process.env.AGENT_DEVICE_RUN_IOS_INTEGRATION_ON_CI);
let didRunIosPhysicalSession = false;

test.after(() => {
  runCliJson(['close', ...iosTarget, '--json', ...session]);
  if (iosPhysicalUdid && didRunIosPhysicalSession) {
    runCliJson(['close', '--platform', 'ios', '--udid', iosPhysicalUdid, '--json', '--session', 'ios-device-test']);
  }
});

test('ios settings commands', { skip: shouldSkipIos() }, async () => {
  const integration = createIntegrationTestContext({
    platform: 'ios',
    testName: 'ios settings commands',
  });
  const openArgs = ['open', 'com.apple.Preferences', ...iosTarget, '--json', ...session];
  integration.runStep('open settings', openArgs);

  const outPath = path.resolve('test/screenshots/ios-settings.png');
  const shotArgs = ['screenshot', outPath, ...iosTarget, '--json', ...session];
  const shot = integration.runStep('screenshot settings', shotArgs);
  integration.assertResult(existsSync(outPath), 'screenshot file missing', shotArgs, shot, {
    detail: `expected screenshot file at ${outPath}`,
  });

  const snapshotArgs = ['snapshot', '-i', '--json', ...session];
  const snapshot = integration.runStep('snapshot', snapshotArgs);
  integration.assertResult(Array.isArray(snapshot.json?.data?.nodes), 'snapshot nodes', snapshotArgs, snapshot, {
    detail: 'expected snapshot to include a nodes array',
  });

  const openGeneralArgs = ['click', 'role=cell', 'label=General', '--json', ...session];
  const openGeneral = integration.runStep('open general', openGeneralArgs);
  integration.assertResult(
    openGeneral.json?.success,
    'open general success',
    openGeneralArgs,
    openGeneral,
    { detail: 'expected click role=cell label=General to return success=true' },
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

test('ios physical device core lifecycle', { skip: shouldSkipIosPhysicalDevice() }, async () => {
  const integration = createIntegrationTestContext({
    platform: 'ios',
    testName: 'ios physical device core lifecycle',
  });
  const deviceSession = ['--session', 'ios-device-test'];
  const target = ['--platform', 'ios', '--udid', iosPhysicalUdid as string];
  didRunIosPhysicalSession = true;

  const openArgs = ['open', 'com.apple.Preferences', ...target, '--json', ...deviceSession];
  integration.runStep('open settings (device)', openArgs);

  const snapshotArgs = ['snapshot', '--backend', 'xctest', '--json', ...deviceSession];
  const snapshot = integration.runStep('snapshot (device)', snapshotArgs);
  integration.assertResult(
    Array.isArray(snapshot.json?.data?.nodes),
    'snapshot nodes (device)',
    snapshotArgs,
    snapshot,
    { detail: 'expected snapshot to include a nodes array' },
  );

  const clickArgs = ['click', 'role=cell', 'label=General', '--json', ...deviceSession];
  integration.runStep('click general (device)', clickArgs);

  const backArgs = ['back', '--json', ...deviceSession];
  integration.runStep('back (device)', backArgs);
});

function shouldSkipIos(): boolean {
  return process.platform !== 'darwin' || (isCi() && !runIosIntegrationOnCi);
}

function shouldSkipIosPhysicalDevice(): boolean {
  return process.platform !== 'darwin' || !iosPhysicalUdid || isCi();
}

function isCi(): boolean {
  return isEnvTruthy(process.env.CI);
}

function isEnvTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}
