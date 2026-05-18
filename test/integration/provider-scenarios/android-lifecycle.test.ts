import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { test } from 'vitest';
import type { AgentDeviceClient } from '../../../src/client-types.ts';
import { arrayEqual, assertCommandCall, assertPngFile } from './assertions.ts';
import { createAndroidSettingsWorld, waitForFileContent } from './android-world.ts';
import { PROVIDER_SCENARIO_ANDROID } from './fixtures.ts';
import {
  createProviderScenarioTempPath,
  restoreEnv,
  withProviderScenarioResource,
} from './harness.ts';
import {
  closeLoopbackServer,
  listenOnLoopback,
} from '../../../src/__tests__/test-utils/loopback.ts';

type AndroidSettingsWorld = Awaited<ReturnType<typeof createAndroidSettingsWorld>>;

test('Provider-backed integration Android Settings flow uses scripted ADB provider', async () => {
  await withProviderScenarioResource(createAndroidSettingsWorld, async (world) => {
    const client = world.daemon.client();
    await runAndroidSetupAndInstallWorkflow(world, client);
    await runAndroidAppControlAndObservabilityWorkflow(world, client);
    await runAndroidCaptureInteractionAndReplayWorkflow(world, client);
    assertAndroidProviderContract(world);
  });
});

test('Provider-backed integration Android text provider handles Unicode without shell input text', async () => {
  await withProviderScenarioResource(
    async () => await createAndroidSettingsWorld({ nativeTextInjection: true }),
    async (world) => {
      const client = world.daemon.client();
      await client.apps.open({ app: 'settings', ...world.selection });
      const snapshot = await client.capture.snapshot({
        interactiveOnly: true,
        ...world.selection,
      });
      const search = snapshot.nodes.find((node) => node.label === 'Search');
      assert.ok(search, JSON.stringify(snapshot.nodes));

      const fill = await client.interactions.fill({
        ref: `@${search.ref}`,
        text: 'Łódź café',
        delayMs: 2,
        ...world.selection,
      });
      assert.equal(fill.text, 'Łódź café');

      const typed = await client.interactions.type({
        text: 'naïve résumé',
        delayMs: 3,
        ...world.selection,
      });
      assert.equal(typed.text, 'naïve résumé');

      assert.deepEqual(world.textInjectionCalls, [
        {
          action: 'fill',
          target: { x: 195, y: 52 },
          text: 'Łódź café',
          delayMs: 2,
        },
        {
          action: 'type',
          text: 'naïve résumé',
          delayMs: 3,
        },
      ]);
      assert.equal(
        world.adbCalls.some(
          (call) => call[0] === 'shell' && call[1] === 'input' && call[2] === 'text',
        ),
        false,
        JSON.stringify(world.adbCalls),
      );
    },
  );
});

async function runAndroidSetupAndInstallWorkflow(
  world: AndroidSettingsWorld,
  client: AgentDeviceClient,
): Promise<void> {
  const { daemon, apkPath, aabPath, manifestApkPath, selection, tempRoot } = world;

  const devices = await client.devices.list({ platform: 'android' });
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.platform, 'android');
  assert.equal(devices[0]?.id, PROVIDER_SCENARIO_ANDROID.id);
  assert.equal(devices[0]?.name, PROVIDER_SCENARIO_ANDROID.name);
  assert.equal(devices[0]?.target, PROVIDER_SCENARIO_ANDROID.target);
  assert.equal(devices[0]?.booted, true);

  const allowlistedDevices = await client.devices.list({
    platform: 'android',
    androidDeviceAllowlist: PROVIDER_SCENARIO_ANDROID.id,
  });
  assert.equal(allowlistedDevices.length, 1);
  assert.equal(allowlistedDevices[0]?.id, PROVIDER_SCENARIO_ANDROID.id);

  const boot = await client.devices.boot(selection);
  assert.equal(boot.platform, 'android');
  assert.equal(boot.id, PROVIDER_SCENARIO_ANDROID.id);
  assert.equal(boot.booted, true);

  const selectorTriggeredEvent = await client.apps.triggerEvent({
    event: 'pre_open_ping',
    payload: { stage: 'explicit-selector' },
    ...selection,
  });
  assert.equal(selectorTriggeredEvent.event, 'pre_open_ping');
  assert.equal(selectorTriggeredEvent.transport, 'deep-link');
  assert.equal(
    selectorTriggeredEvent.eventUrl,
    'demo://agent-device/event?name=pre_open_ping&payload=%7B%22stage%22%3A%22explicit-selector%22%7D&platform=android',
  );
  assert.equal(daemon.session(), undefined);

  const keyboardDismiss = await client.command.keyboard({ action: 'dismiss', ...selection });
  assert.equal(keyboardDismiss.platform, 'android');
  assert.equal(keyboardDismiss.action, 'dismiss');
  assert.equal(keyboardDismiss.visible, false);
  assert.equal(keyboardDismiss.dismissed, false);

  const open = await client.apps.open({ app: 'settings', ...selection });
  assert.equal(open.device?.id, PROVIDER_SCENARIO_ANDROID.id);

  const sessionBoot = await client.devices.boot();
  assert.equal(sessionBoot.platform, 'android');
  assert.equal(sessionBoot.id, PROVIDER_SCENARIO_ANDROID.id);
  assert.equal(sessionBoot.booted, true);

  const listedApps = await client.apps.list(selection);
  assert.deepEqual(listedApps, ['Demo (com.example.demo)']);

  const rawListedApps = await world.daemon.callCommand('apps', [], selection);
  assert.deepEqual(rawListedApps.json.result.data.apps, ['Demo (com.example.demo)']);

  const allApps = await client.apps.list({ ...selection, appsFilter: 'all' });
  assert.deepEqual(allApps, ['Settings (com.android.settings)', 'Demo (com.example.demo)']);

  const appstate = await client.command.appState(selection);
  assert.equal(appstate.platform, 'android');
  assert.equal(appstate.package, 'com.android.settings');
  assert.equal(appstate.activity, '.Settings');

  const reinstall = await client.apps.reinstall({
    app: 'com.example.demo',
    appPath: apkPath,
    ...selection,
  });
  assert.equal(reinstall.platform, 'android');
  assert.equal(reinstall.appId, 'com.example.demo');
  assert.equal(path.basename(reinstall.appPath), 'Demo.apk');

  const reinstallBundle = await client.apps.reinstall({
    app: 'com.example.demo',
    appPath: aabPath,
    ...selection,
  });
  assert.equal(reinstallBundle.platform, 'android');
  assert.equal(reinstallBundle.appId, 'com.example.demo');
  assert.equal(path.basename(reinstallBundle.appPath), 'Demo.aab');

  const installFromManifest = await client.apps.installFromSource({
    source: { kind: 'path', path: manifestApkPath },
    retainPaths: true,
    retentionMs: 60_000,
    ...selection,
  });
  assert.equal(installFromManifest.packageName, 'io.example.demo_manifest');
  assert.equal(installFromManifest.appName, 'Manifest');
  assert.equal(installFromManifest.launchTarget, 'io.example.demo_manifest');
  assert.ok(installFromManifest.installablePath?.endsWith('ManifestDemo.apk'));
  assert.equal(typeof installFromManifest.materializationId, 'string');
  const releaseManifestInstall = await client.materializations.release({
    materializationId: String(installFromManifest.materializationId),
    ...selection,
  });
  assert.equal(releaseManifestInstall.released, true);

  const artifactServer = await createLocalArtifactServer(manifestApkPath);
  const previousPrivateSourceUrls = process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS;
  process.env.AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS = '1';
  try {
    const installFromUrl = await client.apps.installFromSource({
      source: {
        kind: 'url',
        url: artifactServer.url,
        headers: {
          authorization: 'Bearer provider-scenario',
          'x-build': '42',
        },
      },
      ...selection,
    });
    assert.equal(installFromUrl.packageName, 'io.example.demo_manifest');
    assert.equal(artifactServer.lastHeaders.authorization, 'Bearer provider-scenario');
    assert.equal(artifactServer.lastHeaders['x-build'], '42');
  } finally {
    restoreEnv('AGENT_DEVICE_ALLOW_PRIVATE_SOURCE_URLS', previousPrivateSourceUrls);
    await artifactServer.close();
  }

  const push = await client.apps.push({
    app: 'com.example.demo',
    payload: {
      action: 'com.example.demo.PUSH',
      extras: { message: 'hello', unread: 2, foreground: true },
    },
    ...selection,
  });
  assert.equal(push.package, 'com.example.demo');
  assert.equal(push.action, 'com.example.demo.PUSH');
  assert.equal(push.extrasCount, 3);

  const pushPayloadPath = path.join(tempRoot, 'payload.json');
  fs.writeFileSync(
    pushPayloadPath,
    JSON.stringify({
      action: 'com.example.demo.FILE_PUSH',
      extras: { source: 'relative-file' },
    }),
    'utf8',
  );
  const filePush = await daemon.callCommand(
    'push',
    ['com.example.demo', './payload.json'],
    selection,
    {
      meta: { cwd: tempRoot },
    },
  );
  assert.equal(filePush.json.result.data.package, 'com.example.demo');
  assert.equal(filePush.json.result.data.action, 'com.example.demo.FILE_PUSH');
  assert.equal(filePush.json.result.data.extrasCount, 1);

  const bracePayloadPath = path.join(tempRoot, '{payload}.json');
  fs.writeFileSync(
    bracePayloadPath,
    JSON.stringify({
      action: 'com.example.demo.BRACE_PUSH',
      extras: { source: 'brace-file' },
    }),
    'utf8',
  );
  const braceFilePush = await daemon.callCommand(
    'push',
    ['com.example.demo', './{payload}.json'],
    selection,
    { meta: { cwd: tempRoot } },
  );
  assert.equal(braceFilePush.json.result.data.package, 'com.example.demo');
  assert.equal(braceFilePush.json.result.data.action, 'com.example.demo.BRACE_PUSH');
  assert.equal(braceFilePush.json.result.data.extrasCount, 1);

  const clipboard = await client.command.clipboard({ action: 'read', ...selection });
  assert.equal(clipboard.text, 'hello');

  const clipboardWrite = await client.command.clipboard({
    action: 'write',
    text: 'android otp',
    ...selection,
  });
  assert.equal(clipboardWrite.textLength, 11);

  const clipboardAfterWrite = await client.command.clipboard({
    action: 'read',
    ...selection,
  });
  assert.equal(clipboardAfterWrite.text, 'android otp');

  const keyboard = await client.command.keyboard({ action: 'status', ...selection });
  assert.equal(keyboard.visible, false);
}

async function runAndroidAppControlAndObservabilityWorkflow(
  world: AndroidSettingsWorld,
  client: AgentDeviceClient,
): Promise<void> {
  const { daemon, selection, spawnedLogcat } = world;

  await client.settings.update({ setting: 'appearance', state: 'dark', ...selection });
  await client.settings.update({
    setting: 'location',
    state: 'set',
    latitude: 37.3349,
    longitude: -122.009,
    ...selection,
  });
  await client.settings.update({ setting: 'fingerprint', state: 'match', ...selection });
  const demoOpen = await client.apps.open({
    app: 'com.example.demo',
    activity: 'com.example.demo/.MainActivity',
    relaunch: true,
    ...selection,
  });
  assert.equal(demoOpen.appBundleId, 'com.example.demo');
  const triggeredEvent = await client.apps.triggerEvent({
    event: 'screenshot_taken',
    payload: { source: 'provider-scenario', foreground: true },
    ...selection,
  });
  assert.equal(triggeredEvent.event, 'screenshot_taken');
  assert.equal(triggeredEvent.transport, 'deep-link');
  assert.equal(
    triggeredEvent.eventUrl,
    'demo://agent-device/event?name=screenshot_taken&payload=%7B%22source%22%3A%22provider-scenario%22%2C%22foreground%22%3Atrue%7D&platform=android',
  );
  const sessionAfterTriggeredEvent = daemon.session();
  assert.equal(sessionAfterTriggeredEvent?.appBundleId, 'com.example.demo');
  assert.ok(
    sessionAfterTriggeredEvent?.actions.some(
      (action) =>
        action.command === 'trigger-app-event' && action.positionals[0] === 'screenshot_taken',
    ),
    JSON.stringify(sessionAfterTriggeredEvent?.actions),
  );
  await client.settings.update({
    setting: 'permission',
    state: 'grant',
    permission: 'camera',
    ...selection,
  });

  const logsStart = await client.observability.logs({ action: 'start', ...selection });
  assert.equal(logsStart.started, true);

  const logsPath = await client.observability.logs({ action: 'path', ...selection });
  assert.equal(logsPath.active, true);
  assert.equal(logsPath.backend, 'android');
  assert.equal(typeof logsPath.path, 'string');
  const appLogPath = logsPath.path as string;
  await waitForFileContent(appLogPath, 'https://api.example.com/v1/login');

  fs.writeFileSync(appLogPath, 'before-restart', 'utf8');
  fs.writeFileSync(`${appLogPath}.1`, 'older', 'utf8');
  const logsRestart = await client.observability.logs({
    action: 'clear',
    restart: true,
    ...selection,
  });
  assert.equal(logsRestart.path, appLogPath);
  assert.equal(logsRestart.cleared, true);
  assert.equal(logsRestart.restarted, true);
  assert.equal(fs.existsSync(`${appLogPath}.1`), false);
  assert.ok(
    spawnedLogcat.some((child) => child.killed),
    'Expected logs clear --restart to stop the first scripted logcat stream',
  );
  await waitForFileContent(appLogPath, 'https://api.example.com/v1/login');

  const network = await client.observability.network({
    action: 'dump',
    limit: 5,
    include: 'all',
    ...selection,
  });
  assert.equal(network.active, true);
  assert.equal(network.backend, 'android');
  assert.equal(network.include, 'all');
  const networkEntries = Array.isArray(network.entries) ? network.entries : [];
  assert.equal(networkEntries.length, 1, JSON.stringify(network));
  const latestNetworkEntry = networkEntries[0] as Record<string, unknown>;
  assert.equal(latestNetworkEntry.method, 'POST');
  assert.equal(latestNetworkEntry.url, 'https://api.example.com/v1/login');
  assert.equal(latestNetworkEntry.status, 401);
  assert.equal(latestNetworkEntry.headers, '{"x-id":"abc"}');
  assert.equal(latestNetworkEntry.requestBody, '{"email":"test@example.com"}');
  assert.equal(latestNetworkEntry.responseBody, '{"error":"bad_credentials"}');

  const perf = await client.observability.perf(selection);
  assert.equal(perf.platform, 'android');
  assert.equal(perf.deviceId, PROVIDER_SCENARIO_ANDROID.id);
  const metrics = perf.metrics as Record<string, any>;
  assert.equal(metrics.startup?.available, true, JSON.stringify(perf));
  assert.equal(metrics.startup?.method, 'open-command-roundtrip');
  assert.ok(metrics.startup?.sampleCount >= 2, JSON.stringify(metrics.startup));
  const startupSamples = Array.isArray(metrics.startup?.samples) ? metrics.startup.samples : [];
  assert.equal(startupSamples.at(-1)?.appTarget, 'com.example.demo');
  assert.equal(startupSamples.at(-1)?.appBundleId, 'com.example.demo');
  assert.equal(metrics.memory?.available, true, JSON.stringify(perf));
  assert.equal(metrics.memory?.totalPssKb, 216524);
  assert.equal(metrics.memory?.totalRssKb, 340112);
  assert.equal(metrics.cpu?.available, true, JSON.stringify(perf));
  assert.equal(metrics.cpu?.usagePercent, 9);
  assert.deepEqual(metrics.cpu?.matchedProcesses, ['com.example.demo', 'com.example.demo:sync']);
  assert.equal(metrics.fps?.available, true, JSON.stringify(perf));
  assert.equal(metrics.fps?.droppedFramePercent, 25);
  const relatedActions = Array.isArray(metrics.fps?.relatedActions)
    ? metrics.fps.relatedActions
    : [];
  assert.ok(
    relatedActions.some(
      (action: Record<string, unknown>) =>
        action.command === 'open' && action.target === 'com.example.demo',
    ),
    JSON.stringify(metrics.fps),
  );

  const logsStop = await client.observability.logs({ action: 'stop', ...selection });
  assert.equal(logsStop.stopped, true);

  fs.writeFileSync(appLogPath, 'before-clear', 'utf8');
  fs.writeFileSync(`${appLogPath}.1`, 'older', 'utf8');
  const logsClear = await client.observability.logs({ action: 'clear', ...selection });
  assert.equal(logsClear.path, appLogPath);
  assert.equal(logsClear.cleared, true);
  assert.equal(fs.readFileSync(appLogPath, 'utf8'), '');
  assert.equal(fs.existsSync(`${appLogPath}.1`), false);

  const animations = await client.settings.update({
    setting: 'animations',
    state: 'off',
    ...selection,
  });
  assert.equal(animations.scale, '0');
  assert.deepEqual(animations.keys, [
    'window_animation_scale',
    'transition_animation_scale',
    'animator_duration_scale',
  ]);
  await client.apps.open({ app: 'settings', ...selection });

  const logsDoctor = await client.observability.logs({ action: 'doctor', ...selection });
  assert.equal((logsDoctor.checks as { adbAvailable?: boolean }).adbAvailable, true);
}

async function runAndroidCaptureInteractionAndReplayWorkflow(
  world: AndroidSettingsWorld,
  client: AgentDeviceClient,
): Promise<void> {
  const { daemon, selection, tempRoot } = world;
  const screenshotPath = createProviderScenarioTempPath(
    'agent-device-provider-scenario-android',
    'png',
  );
  const fastScreenshotPath = createProviderScenarioTempPath(
    'agent-device-provider-scenario-android-fast',
    'png',
  );

  const baselineDiff = await client.capture.diff({
    kind: 'snapshot',
    interactiveOnly: true,
    ...selection,
  });
  assert.equal(baselineDiff.mode, 'snapshot');
  assert.equal(baselineDiff.baselineInitialized, true);
  assert.deepEqual(baselineDiff.summary, { additions: 0, removals: 0, unchanged: 3 });
  assert.deepEqual(baselineDiff.lines, []);

  const snapshot = await client.capture.snapshot({ interactiveOnly: true, ...selection });
  const apps = snapshot.nodes.find((node) => node.label === 'Apps');
  const search = snapshot.nodes.find((node) => node.label === 'Search');
  assert.ok(apps, JSON.stringify(snapshot.nodes));
  assert.ok(search, JSON.stringify(snapshot.nodes));
  assert.equal(apps.ref, 'e2', JSON.stringify(snapshot.nodes));
  assert.equal(search.ref, 'e3', JSON.stringify(snapshot.nodes));

  const rawSnapshot = await daemon.callCommand('snapshot', [], {
    snapshotRaw: true,
    ...selection,
  });
  assert.equal(rawSnapshot.statusCode, 200, JSON.stringify(rawSnapshot.json));
  assert.equal(rawSnapshot.json?.result?.data?.nodes?.[0]?.type, 'android.widget.ScrollView');

  const diff = await client.capture.diff({
    kind: 'snapshot',
    interactiveOnly: true,
    ...selection,
  });
  assert.equal(diff.mode, 'snapshot');
  assert.equal(diff.baselineInitialized, false);
  assert.deepEqual(diff.summary, { additions: 0, removals: 0, unchanged: 3 });

  const rotate = await client.command.rotate({
    orientation: 'landscape-left',
    ...selection,
  });
  assert.equal(rotate.action, 'rotate');
  assert.equal(rotate.orientation, 'landscape-left');

  const appSwitcher = await client.command.appSwitcher(selection);
  assert.equal(appSwitcher.action, 'app-switcher');

  const press = await client.interactions.press({ ref: `@${apps.ref}`, ...selection });
  assert.equal(press.x, 88);
  assert.equal(press.y, 151);

  const heldPress = await client.interactions.press({
    x: 30,
    y: 40,
    count: 2,
    holdMs: 5,
    jitterPx: 1,
    ...selection,
  });
  assert.equal(heldPress.count, 2);
  assert.equal(heldPress.holdMs, 5);
  assert.equal(heldPress.jitterPx, 1);

  const click = await client.interactions.click({ ref: `@${apps.ref}`, ...selection });
  assert.equal(click.x, 88);
  assert.equal(click.y, 151);

  const unrecordedPress = await daemon.callCommand('press', ['50', '60'], {
    ...selection,
    noRecord: true,
  });
  assert.equal(unrecordedPress.json?.result?.data?.x, 50);
  assert.equal(
    daemon
      .session()
      ?.actions.some(
        (action) =>
          action.command === 'press' &&
          action.positionals[0] === '50' &&
          action.positionals[1] === '60',
      ),
    false,
  );

  const fill = await client.interactions.fill({
    ref: `@${search.ref}`,
    text: 'Display',
    ...selection,
  });
  assert.equal(fill.text, 'Display');

  const getText = await client.interactions.get({
    format: 'text',
    selector: 'id=com.android.settings:id/search',
    ...selection,
  });
  assert.equal(getText.text, 'Display');

  const isVisible = await client.interactions.is({
    predicate: 'visible',
    selector: 'label=Apps',
    ...selection,
  });
  assert.equal(isVisible.pass, true);

  const waitText = await client.command.wait({ text: 'Apps', timeoutMs: 100, ...selection });
  assert.equal(waitText.text, 'Apps');

  const swipe = await client.interactions.swipe({
    from: { x: 20, y: 200 },
    to: { x: 20, y: 100 },
    count: 2,
    pauseMs: 1,
    pattern: 'ping-pong',
    ...selection,
  });
  assert.equal(swipe.count, 2);
  assert.equal(swipe.pauseMs, 1);
  assert.equal(swipe.pattern, 'ping-pong');

  const batch = await client.batch.run({
    steps: [
      {
        command: 'press',
        positionals: ['10', '20'],
        flags: { count: 2, intervalMs: 1 },
      },
    ],
    onError: 'stop',
    maxSteps: 1,
    ...selection,
  });
  assert.equal(batch.executed, 1);
  assert.equal(
    (batch.results as Array<{ data?: { count?: number } }> | undefined)?.[0]?.data?.count,
    2,
  );

  const replayPath = path.join(tempRoot, 'settings-search.ad');
  fs.writeFileSync(
    replayPath,
    [
      'snapshot -i',
      'press @e2 Apps --count 2 --interval-ms 1',
      'fill @e3 Search "Network"',
      'get text @e3 Search',
      '',
    ].join('\n'),
  );
  const updateReplay = await client.replay.run({
    path: replayPath,
    update: true,
    ...selection,
  });
  assert.equal(updateReplay.replayed, 4);
  assert.equal(updateReplay.healed, 0);

  const replayEnvPath = path.join(tempRoot, 'settings-env.ad');
  fs.writeFileSync(
    replayEnvPath,
    ['snapshot -i', 'press @e2 "${APP_LABEL}"', 'get text @e3 Search', ''].join('\n'),
  );
  const replayEnv = await client.replay.run({
    path: replayEnvPath,
    env: ['APP_LABEL=Apps'],
    ...selection,
  });
  assert.equal(replayEnv.replayed, 3);

  const screenshot = await client.capture.screenshot({
    path: screenshotPath,
    ...selection,
  });
  assert.equal(screenshot.path, screenshotPath);
  assertPngFile(screenshotPath);

  const fastScreenshot = await client.capture.screenshot({
    path: fastScreenshotPath,
    overlayRefs: true,
    stabilize: false,
    ...selection,
  });
  assert.equal(fastScreenshot.path, fastScreenshotPath);
  assert.ok(
    Array.isArray(fastScreenshot.overlayRefs) && fastScreenshot.overlayRefs.length > 0,
    JSON.stringify(fastScreenshot),
  );
  assertPngFile(fastScreenshotPath);

  const screenshotOutPath = path.join(tempRoot, 'screenshot-out-flag.png');
  const screenshotWithOut = await daemon.callCommand('screenshot', [], {
    out: screenshotOutPath,
    ...selection,
  });
  assert.equal(screenshotWithOut.statusCode, 200, JSON.stringify(screenshotWithOut.json));
  assert.equal(screenshotWithOut.json?.result?.data?.path, screenshotOutPath);
  assertPngFile(screenshotOutPath);

  const beforeCloseOpen = await client.apps.open({ app: 'com.example.demo', ...selection });
  assert.equal(beforeCloseOpen.appBundleId, 'com.example.demo');
  const logsBeforeClose = await client.observability.logs({ action: 'start', ...selection });
  assert.equal(logsBeforeClose.started, true);
  const savedReplayPath = path.join(tempRoot, 'saved-session.ad');
  const close = await daemon.callCommand('close', [], {
    saveScript: savedReplayPath,
    shutdown: true,
  });
  assert.equal(close.json?.result?.data?.shutdown?.success, true);
  assert.equal(fs.existsSync(savedReplayPath), true);
  assert.equal(daemon.session(), undefined);

  const testReplayPath = path.join(tempRoot, 'settings-smoke.ad');
  fs.writeFileSync(
    testReplayPath,
    ['context platform=android', 'open settings', 'snapshot -i', 'is visible label=Apps', ''].join(
      '\n',
    ),
  );
  const testSuite = await client.replay.test({
    paths: [testReplayPath],
    artifactsDir: path.join(tempRoot, 'artifacts'),
    ...selection,
  });
  assert.equal(testSuite.total, 1);
  assert.equal(testSuite.passed, 1, JSON.stringify(testSuite));
  assert.equal(testSuite.failed, 0, JSON.stringify(testSuite));
}

function assertAndroidProviderContract(world: AndroidSettingsWorld): void {
  assertAndroidInventoryContract(world);
  assertAndroidInstallAndLaunchContract(world);
  assertAndroidPushAndEventContract(world);
  assertAndroidObservabilityContract(world);
  assertAndroidSettingsContract(world);
  assertAndroidInteractionContract(world);
  assertAndroidShutdownContract(world);
}

function assertAndroidInventoryContract(world: AndroidSettingsWorld): void {
  assert.ok(
    world.inventoryRequests.some((request) =>
      request.androidSerialAllowlist?.includes(PROVIDER_SCENARIO_ANDROID.id),
    ),
    JSON.stringify(world.inventoryRequests),
  );
}

function assertAndroidInstallAndLaunchContract(world: AndroidSettingsWorld): void {
  const { adbCalls, installCalls, bundleInstallCalls } = world;
  assertCommandCall(adbCalls, ['shell', 'am', 'start', '-W', '-a', 'android.settings.SETTINGS']);
  assertCommandCall(adbCalls, ['shell', 'am', 'force-stop', 'com.example.demo']);
  assertCommandCall(adbCalls, [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.MAIN',
    '-c',
    'android.intent.category.DEFAULT',
    '-c',
    'android.intent.category.LAUNCHER',
    '-n',
    'com.example.demo/.MainActivity',
  ]);
  assertCommandCall(adbCalls, ['uninstall', 'com.example.demo']);
  assert.equal(installCalls.length, 3);
  assert.equal(path.basename(installCalls[0]?.apkPath ?? ''), 'Demo.apk');
  assert.equal(installCalls[0]?.replace, true);
  assert.equal(path.basename(installCalls[1]?.apkPath ?? ''), 'ManifestDemo.apk');
  assert.equal(path.basename(installCalls[2]?.apkPath ?? ''), 'ManifestDemo.apk');
  assert.equal(installCalls[1]?.replace, true);
  assert.deepEqual(bundleInstallCalls, [{ bundlePath: world.aabPath, mode: 'universal' }]);
}

function assertAndroidPushAndEventContract(world: AndroidSettingsWorld): void {
  const { adbCalls } = world;
  assertCommandCall(adbCalls, [
    'shell',
    'am',
    'broadcast',
    '-a',
    'com.example.demo.PUSH',
    '-p',
    'com.example.demo',
    '--es',
    'message',
    'hello',
    '--ei',
    'unread',
    '2',
    '--ez',
    'foreground',
    'true',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'am',
    'broadcast',
    '-a',
    'com.example.demo.FILE_PUSH',
    '-p',
    'com.example.demo',
    '--es',
    'source',
    'relative-file',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'am',
    'broadcast',
    '-a',
    'com.example.demo.BRACE_PUSH',
    '-p',
    'com.example.demo',
    '--es',
    'source',
    'brace-file',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'demo://agent-device/event?name=pre_open_ping&payload=%7B%22stage%22%3A%22explicit-selector%22%7D&platform=android',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'am',
    'start',
    '-W',
    '-a',
    'android.intent.action.VIEW',
    '-d',
    'demo://agent-device/event?name=screenshot_taken&payload=%7B%22source%22%3A%22provider-scenario%22%2C%22foreground%22%3Atrue%7D&platform=android',
  ]);
  assertCommandCall(adbCalls, ['shell', 'cmd', 'clipboard', 'get', 'text']);
  assertCommandCall(adbCalls, ['shell', 'cmd', 'clipboard', 'set', 'text', 'android otp']);
  assertCommandCall(adbCalls, ['shell', 'dumpsys', 'input_method']);
}

function assertAndroidObservabilityContract(world: AndroidSettingsWorld): void {
  const { adbCalls, spawnedLogcat } = world;
  assertCommandCall(adbCalls, ['shell', 'pidof', 'com.example.demo']);
  assertCommandCall(adbCalls, ['shell', 'dumpsys', 'meminfo', 'com.example.demo']);
  assertCommandCall(adbCalls, ['shell', 'dumpsys', 'cpuinfo']);
  assertCommandCall(adbCalls, ['shell', 'dumpsys', 'gfxinfo', 'com.example.demo', 'framestats']);
  assertCommandCall(adbCalls, ['shell', 'dumpsys', 'gfxinfo', 'com.example.demo', 'reset']);
  assert.ok(
    spawnedLogcat.some((child) => child.killed),
    'Expected logs stop to terminate the scripted logcat stream',
  );
  assert.ok(
    spawnedLogcat.filter((child) => child.killed).length >= 2,
    'Expected close to auto-stop the active scripted logcat stream',
  );
}

function assertAndroidSettingsContract(world: AndroidSettingsWorld): void {
  const { adbCalls } = world;
  assertCommandCall(adbCalls, ['shell', 'cmd', 'uimode', 'night', 'yes']);
  assertCommandCall(adbCalls, ['emu', 'geo', 'fix', '-122.009', '37.3349']);
  assertCommandCall(adbCalls, ['shell', 'cmd', 'fingerprint', 'touch', '1']);
  assertCommandCall(adbCalls, [
    'shell',
    'pm',
    'grant',
    'com.example.demo',
    'android.permission.CAMERA',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'settings',
    'put',
    'global',
    'window_animation_scale',
    '0',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'settings',
    'put',
    'global',
    'transition_animation_scale',
    '0',
  ]);
  assertCommandCall(adbCalls, [
    'shell',
    'settings',
    'put',
    'global',
    'animator_duration_scale',
    '0',
  ]);
  assertCommandCall(adbCalls, ['shell', 'echo', 'ok']);
}

function assertAndroidInteractionContract(world: AndroidSettingsWorld): void {
  const { adbCalls } = world;
  assertCommandCall(adbCalls, ['exec-out', 'uiautomator', 'dump', '/dev/tty']);
  assertCommandCall(adbCalls, ['shell', 'input', 'tap', '88', '151']);
  assertCommandCall(adbCalls, [
    'shell',
    'settings',
    'put',
    'system',
    'accelerometer_rotation',
    '0',
  ]);
  assertCommandCall(adbCalls, ['shell', 'settings', 'put', 'system', 'user_rotation', '1']);
  assertCommandCall(adbCalls, ['shell', 'input', 'keyevent', '187']);
  assert.equal(
    adbCalls.filter((call) => arrayEqual(call, ['shell', 'input', 'tap', '10', '20'])).length,
    2,
  );
  assertCommandCall(adbCalls, ['shell', 'input', 'tap', '50', '60']);
  assertCommandCall(adbCalls, ['shell', 'input', 'swipe', '30', '40', '30', '40', '5']);
  assertCommandCall(adbCalls, ['shell', 'input', 'swipe', '31', '40', '31', '40', '5']);
  assertCommandCall(adbCalls, ['shell', 'input', 'swipe', '20', '200', '20', '100', '250']);
  assertCommandCall(adbCalls, ['shell', 'input', 'swipe', '20', '100', '20', '200', '250']);
  assert.equal(
    adbCalls.filter((call) => arrayEqual(call, ['shell', 'input', 'tap', '88', '151'])).length,
    5,
  );
  assertCommandCall(adbCalls, ['shell', 'input', 'text', 'Display']);
  assertCommandCall(adbCalls, ['shell', 'input', 'text', 'Network']);
  assert.equal(
    adbCalls.filter((call) => arrayEqual(call, ['exec-out', 'screencap', '-p'])).length,
    3,
  );
  assert.equal(
    adbCalls.filter((call) =>
      arrayEqual(call, ['shell', 'settings put global sysui_demo_allowed 1']),
    ).length,
    2,
  );
}

function assertAndroidShutdownContract(world: AndroidSettingsWorld): void {
  const { adbCalls } = world;
  assertCommandCall(adbCalls, ['emu', 'kill']);
  world.assertNoHostAdbCalls();
}

async function createLocalArtifactServer(filePath: string): Promise<{
  url: string;
  readonly lastHeaders: http.IncomingHttpHeaders;
  close: () => Promise<void>;
}> {
  let lastHeaders: http.IncomingHttpHeaders = {};
  const server = http.createServer((req, res) => {
    lastHeaders = req.headers;
    res.writeHead(200, {
      'content-type': 'application/vnd.android.package-archive',
      'content-disposition': 'attachment; filename="ManifestDemo.apk"',
    });
    fs.createReadStream(filePath).pipe(res);
  });

  const port = await listenOnLoopback(server);

  return {
    url: `http://127.0.0.1:${port}/ManifestDemo.apk`,
    get lastHeaders() {
      return lastHeaders;
    },
    close: async () => await closeLoopbackServer(server),
  };
}
