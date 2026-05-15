import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { arrayEqual, assertCommandCall, assertPngFile } from './assertions.ts';
import { createAndroidSettingsWorld, waitForFileContent } from './android-world.ts';
import { DEVICE_LAB_ANDROID } from './fixtures.ts';

test('Device Lab Android Settings flow uses scripted ADB provider', async () => {
  const world = await createAndroidSettingsWorld();
  const {
    adbCalls,
    apkPath,
    daemon,
    installCalls,
    manifestApkPath,
    selection,
    spawnedLogcat,
    tempRoot,
  } = world;

  try {
    {
      const client = daemon.client();
      const screenshotPath = path.join(os.tmpdir(), `agent-device-lab-android-${Date.now()}.png`);
      const fastScreenshotPath = path.join(
        os.tmpdir(),
        `agent-device-lab-android-fast-${Date.now()}.png`,
      );

      const devices = await client.devices.list({ platform: 'android' });
      assert.equal(devices.length, 1);
      assert.equal(devices[0]?.platform, 'android');
      assert.equal(devices[0]?.id, DEVICE_LAB_ANDROID.id);
      assert.equal(devices[0]?.name, DEVICE_LAB_ANDROID.name);
      assert.equal(devices[0]?.target, DEVICE_LAB_ANDROID.target);
      assert.equal(devices[0]?.booted, true);

      const boot = await client.devices.boot(selection);
      assert.equal(boot.platform, 'android');
      assert.equal(boot.id, DEVICE_LAB_ANDROID.id);
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
      assert.equal(open.device?.id, DEVICE_LAB_ANDROID.id);

      const sessionBoot = await client.devices.boot();
      assert.equal(sessionBoot.platform, 'android');
      assert.equal(sessionBoot.id, DEVICE_LAB_ANDROID.id);
      assert.equal(sessionBoot.booted, true);

      const listedApps = await client.apps.list(selection);
      assert.deepEqual(listedApps, ['Demo (com.example.demo)']);

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
        { meta: { cwd: tempRoot } },
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

      const triggeredEvent = await client.apps.triggerEvent({
        event: 'screenshot_taken',
        payload: { source: 'device-lab', foreground: true },
        ...selection,
      });
      assert.equal(triggeredEvent.event, 'screenshot_taken');
      assert.equal(triggeredEvent.transport, 'deep-link');
      assert.equal(
        triggeredEvent.eventUrl,
        'demo://agent-device/event?name=screenshot_taken&payload=%7B%22source%22%3A%22device-lab%22%2C%22foreground%22%3Atrue%7D&platform=android',
      );

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

      await client.settings.update({ setting: 'appearance', state: 'dark', ...selection });
      await client.settings.update({
        setting: 'location',
        state: 'set',
        latitude: 37.3349,
        longitude: -122.009,
        ...selection,
      });
      await client.settings.update({ setting: 'fingerprint', state: 'match', ...selection });
      const demoOpen = await client.apps.open({ app: 'com.example.demo', ...selection });
      assert.equal(demoOpen.appBundleId, 'com.example.demo');
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
      assert.equal(perf.deviceId, DEVICE_LAB_ANDROID.id);
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
      assert.deepEqual(metrics.cpu?.matchedProcesses, [
        'com.example.demo',
        'com.example.demo:sync',
      ]);
      assert.equal(metrics.fps?.available, true, JSON.stringify(perf));
      assert.equal(metrics.fps?.droppedFramePercent, 25);

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

      const click = await client.interactions.click({ ref: `@${apps.ref}`, ...selection });
      assert.equal(click.x, 88);
      assert.equal(click.y, 151);

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

      const batch = await client.batch.run({
        steps: [
          {
            command: 'press',
            positionals: ['10', '20'],
            flags: { count: 2, intervalMs: 1 },
          },
        ],
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
      const replay = await daemon.callCommand('replay', [replayPath], selection);
      assert.equal(replay.statusCode, 200, JSON.stringify(replay.json));
      assert.equal(replay.json?.result?.data?.replayed, 4);
      assert.equal(replay.json?.result?.data?.healed, 0);

      const screenshot = await client.capture.screenshot({
        path: screenshotPath,
        ...selection,
      });
      assert.equal(screenshot.path, screenshotPath);
      assertPngFile(screenshotPath);

      const fastScreenshot = await client.capture.screenshot({
        path: fastScreenshotPath,
        stabilize: false,
        ...selection,
      });
      assert.equal(fastScreenshot.path, fastScreenshotPath);
      assertPngFile(fastScreenshotPath);

      const beforeCloseOpen = await client.apps.open({ app: 'com.example.demo', ...selection });
      assert.equal(beforeCloseOpen.appBundleId, 'com.example.demo');
      const logsBeforeClose = await client.observability.logs({ action: 'start', ...selection });
      assert.equal(logsBeforeClose.started, true);
      await client.apps.close({});
      assert.equal(daemon.session(), undefined);

      const testReplayPath = path.join(tempRoot, 'settings-smoke.ad');
      fs.writeFileSync(
        testReplayPath,
        [
          'context platform=android',
          'open settings',
          'snapshot -i',
          'is visible label=Apps',
          '',
        ].join('\n'),
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

    assertCommandCall(adbCalls, ['shell', 'am', 'start', '-W', '-a', 'android.settings.SETTINGS']);
    assertCommandCall(adbCalls, ['uninstall', 'com.example.demo']);
    assert.equal(installCalls.length, 2);
    assert.equal(path.basename(installCalls[0]?.apkPath ?? ''), 'Demo.apk');
    assert.equal(installCalls[0]?.replace, true);
    assert.equal(path.basename(installCalls[1]?.apkPath ?? ''), 'ManifestDemo.apk');
    assert.equal(installCalls[1]?.replace, true);
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
      'demo://agent-device/event?name=screenshot_taken&payload=%7B%22source%22%3A%22device-lab%22%2C%22foreground%22%3Atrue%7D&platform=android',
    ]);
    assertCommandCall(adbCalls, ['shell', 'cmd', 'clipboard', 'get', 'text']);
    assertCommandCall(adbCalls, ['shell', 'cmd', 'clipboard', 'set', 'text', 'android otp']);
    assertCommandCall(adbCalls, ['shell', 'dumpsys', 'input_method']);
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
    assert.equal(
      adbCalls.filter((call) => arrayEqual(call, ['shell', 'input', 'tap', '88', '151'])).length,
      4,
    );
    assertCommandCall(adbCalls, ['shell', 'input', 'text', 'Display']);
    assertCommandCall(adbCalls, ['shell', 'input', 'text', 'Network']);
    assert.equal(
      adbCalls.filter((call) => arrayEqual(call, ['exec-out', 'screencap', '-p'])).length,
      2,
    );
    assert.equal(
      adbCalls.filter((call) =>
        arrayEqual(call, ['shell', 'settings put global sysui_demo_allowed 1']),
      ).length,
      1,
    );
    world.assertNoHostAdbCalls();
  } finally {
    await world.close();
  }
});
