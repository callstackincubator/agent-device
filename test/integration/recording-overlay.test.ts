import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  analyzeOverlayCrop,
  createIntegrationTestContext,
  runCliJson,
  runRecordingInspect,
  type RecordingInspectionManifest,
} from './test-helpers.ts';

const recordingE2EEnabled = isTruthy(process.env.AGENT_DEVICE_RECORDING_E2E);

test('recording tap overlay on iOS simulator', { skip: shouldSkipIosRecordingE2E() }, () => {
  const integration = createRecordingIntegrationContext('ios', 'recording tap overlay');
  const outPath = path.join(integration.artifactDir(), 'ios-tap.mp4');
  const session = ['--session', 'recording-ios-tap'];

  integration.runStep('open settings', [
    'open',
    'com.apple.Preferences',
    '--platform',
    'ios',
    '--relaunch',
    '--json',
    ...session,
  ]);
  integration.runStep('record start', ['record', 'start', outPath, '--json', ...session]);
  integration.runStep('tap general', ['click', 'role=cell', 'label=General', '--json', ...session]);
  const stop = integration.runStep('record stop', ['record', 'stop', '--json', ...session]);

  assertRecordingArtifacts(stop, outPath);
  const manifest = inspectRecording(
    outPath,
    stop.json?.data?.telemetryPath,
    integration.artifactDir(),
    'ios-tap',
  );
  assertOverlayForKind(manifest, 'tap', { minPixelCount: 180, maxCenterDistance: 80 });
});

test('recording scroll overlay on iOS simulator', { skip: shouldSkipIosRecordingE2E() }, () => {
  const integration = createRecordingIntegrationContext('ios', 'recording scroll overlay');
  const outPath = path.join(integration.artifactDir(), 'ios-scroll.mp4');
  const session = ['--session', 'recording-ios-scroll'];

  integration.runStep('open settings', [
    'open',
    'com.apple.Preferences',
    '--platform',
    'ios',
    '--relaunch',
    '--json',
    ...session,
  ]);
  integration.runStep('record start', ['record', 'start', outPath, '--json', ...session]);
  integration.runStep('scroll down', ['scroll', 'down', '0.45', '--json', ...session]);
  const stop = integration.runStep('record stop', ['record', 'stop', '--json', ...session]);

  assertRecordingArtifacts(stop, outPath);
  const manifest = inspectRecording(
    outPath,
    stop.json?.data?.telemetryPath,
    integration.artifactDir(),
    'ios-scroll',
  );
  assertOverlayForKind(manifest, 'scroll', { minPixelCount: 5 });
});

test('recording back-swipe overlay on iOS simulator', { skip: shouldSkipIosRecordingE2E() }, () => {
  const integration = createRecordingIntegrationContext('ios', 'recording back swipe overlay');
  const outPath = path.join(integration.artifactDir(), 'ios-back-swipe.mp4');
  const session = ['--session', 'recording-ios-back-swipe'];

  integration.runStep('open settings', [
    'open',
    'com.apple.Preferences',
    '--platform',
    'ios',
    '--relaunch',
    '--json',
    ...session,
  ]);
  integration.runStep('record start', ['record', 'start', outPath, '--json', ...session]);
  integration.runStep('open general', ['press', '201', '319', '--json', ...session]);
  integration.runStep('edge swipe', [
    'swipe',
    '10',
    '400',
    '250',
    '400',
    '250',
    '--json',
    ...session,
  ]);
  const stop = integration.runStep('record stop', ['record', 'stop', '--json', ...session]);

  assertRecordingArtifacts(stop, outPath);
  const manifest = inspectRecording(
    outPath,
    stop.json?.data?.telemetryPath,
    integration.artifactDir(),
    'ios-back-swipe',
  );
  assertOverlayForKind(manifest, 'back-swipe', { minPixelCount: 80 });
});

test('recording tap overlay on Android emulator', { skip: shouldSkipAndroidRecordingE2E() }, () => {
  const integration = createRecordingIntegrationContext('android', 'recording tap overlay');
  const outPath = path.join(integration.artifactDir(), 'android-tap.mp4');
  const session = ['--session', 'recording-android-tap'];

  integration.runStep('open settings', [
    'open',
    'settings',
    '--platform',
    'android',
    '--relaunch',
    '--json',
    ...session,
  ]);
  integration.runStep('record start', ['record', 'start', outPath, '--json', ...session]);
  integration.runStep('tap apps', ['press', '672', '1362', '--json', ...session]);
  integration.runStep('scroll down', ['scroll', 'down', '0.2', '--json', ...session]);
  integration.runStep('settle', ['wait', '1200', '--json', ...session]);
  const stop = integration.runStep('record stop', ['record', 'stop', '--json', ...session]);

  assertRecordingArtifacts(stop, outPath);
  const manifest = inspectRecording(
    outPath,
    stop.json?.data?.telemetryPath,
    integration.artifactDir(),
    'android-tap',
  );
  assertOverlayForKind(manifest, 'tap', { minPixelCount: 180, maxCenterDistance: 80 });
});

test(
  'recording scroll overlay on Android emulator',
  { skip: shouldSkipAndroidRecordingE2E() },
  () => {
    const integration = createRecordingIntegrationContext('android', 'recording scroll overlay');
    const outPath = path.join(integration.artifactDir(), 'android-scroll.mp4');
    const session = ['--session', 'recording-android-scroll'];

    integration.runStep('open settings', [
      'open',
      'settings',
      '--platform',
      'android',
      '--relaunch',
      '--json',
      ...session,
    ]);
    integration.runStep('record start', ['record', 'start', outPath, '--json', ...session]);
    integration.runStep('scroll down', ['scroll', 'down', '0.45', '--json', ...session]);
    integration.runStep('settle', ['wait', '1200', '--json', ...session]);
    const stop = integration.runStep('record stop', ['record', 'stop', '--json', ...session]);

    assertRecordingArtifacts(stop, outPath);
    const manifest = inspectRecording(
      outPath,
      stop.json?.data?.telemetryPath,
      integration.artifactDir(),
      'android-scroll',
    );
    assertOverlayForKind(manifest, 'scroll', { minPixelCount: 5 });
  },
);

function createRecordingIntegrationContext(platform: 'ios' | 'android', testName: string) {
  const runId = new Date().toISOString().replaceAll(':', '-');
  const stateDir = path.resolve('test/artifacts', platform, sanitize(testName), runId, 'state');
  return createIntegrationTestContext({
    platform,
    testName,
    extraEnv: { ...process.env, AGENT_DEVICE_STATE_DIR: stateDir },
  });
}

function assertRecordingArtifacts(result: ReturnType<typeof runCliJson>, outPath: string): void {
  assert.equal(result.status, 0, JSON.stringify(result.json ?? result.stderr));
  assert.equal(result.json?.success, true);
  assert.equal(typeof result.json?.data?.telemetryPath, 'string');
  assert.ok(existsSync(outPath), `expected recording at ${outPath}`);
  assert.ok(
    existsSync(String(result.json?.data?.telemetryPath)),
    `expected telemetry sidecar at ${String(result.json?.data?.telemetryPath)}`,
  );
  assert.equal(
    result.json?.data?.artifacts?.some(
      (artifact: { field?: string }) => artifact.field === 'telemetryPath',
    ),
    true,
    'expected telemetryPath artifact in record stop response',
  );
}

function inspectRecording(
  outPath: string,
  telemetryPath: string,
  artifactDir: string,
  prefix: string,
): RecordingInspectionManifest {
  return runRecordingInspect({
    videoPath: outPath,
    telemetryPath,
    outputDir: path.join(artifactDir, `${prefix}-inspect`),
  });
}

function assertOverlayForKind(
  manifest: RecordingInspectionManifest,
  kind: string,
  options: { minPixelCount: number; maxCenterDistance?: number },
): void {
  const item = manifest.items.find((candidate) => candidate.kind === kind);
  assert.ok(item, `expected manifest item for ${kind}`);
  const analysis = analyzeOverlayCrop(item.cropPath);
  assert.ok(
    analysis.matchingPixelCount >= options.minPixelCount,
    `expected at least ${options.minPixelCount} overlay-colored pixels in ${item.cropPath}, saw ${analysis.matchingPixelCount}`,
  );
  if (options.maxCenterDistance === undefined) {
    return;
  }
  const centerX = analysis.width / 2;
  const centerY = analysis.height / 2;
  const distance = Math.hypot(analysis.centroidX - centerX, analysis.centroidY - centerY);
  assert.ok(
    distance <= options.maxCenterDistance,
    `expected overlay centroid near crop center for ${item.cropPath}, distance=${distance.toFixed(2)}`,
  );
}

function shouldSkipIosRecordingE2E(): string | false {
  if (!recordingE2EEnabled)
    return 'set AGENT_DEVICE_RECORDING_E2E=1 to run live recording overlay tests';
  if (process.platform !== 'darwin') return 'iOS recording overlay E2E runs only on macOS';
  return false;
}

function shouldSkipAndroidRecordingE2E(): string | false {
  if (!recordingE2EEnabled)
    return 'set AGENT_DEVICE_RECORDING_E2E=1 to run live recording overlay tests';
  return false;
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}

function sanitize(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-');
}
