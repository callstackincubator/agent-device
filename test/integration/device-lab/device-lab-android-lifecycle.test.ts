import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'vitest';
import type {
  AndroidAdbProcess,
  AndroidAdbProvider,
} from '../../../src/platforms/android/adb-executor.ts';
import { runCmd } from '../../../src/utils/exec.ts';
import { arrayEqual, assertCommandCall, assertPngFile, validPng } from './assertions.ts';
import { DEVICE_LAB_ANDROID } from './fixtures.ts';
import { restoreEnv, createDeviceLabHarness } from './harness.ts';

test('Device Lab Android Settings flow uses scripted ADB provider', async () => {
  await withFakeHostAdbGuard(async (hostAdbLogPath) => {
    const adbCalls: string[][] = [];
    const installCalls: Array<{ apkPath: string; replace?: boolean }> = [];
    let searchText = '';
    let clipboardText = 'hello';
    const spawnedLogcat: AndroidAdbProcess[] = [];
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-lab-android-deploy-'));
    const apkPath = path.join(tempRoot, 'Demo.apk');
    const previousAppEventTemplate = process.env.AGENT_DEVICE_ANDROID_APP_EVENT_URL_TEMPLATE;
    process.env.AGENT_DEVICE_ANDROID_APP_EVENT_URL_TEMPLATE =
      'demo://agent-device/event?name={event}&payload={payload}&platform={platform}';
    fs.writeFileSync(apkPath, 'placeholder apk');
    const manifestApkPath = await createAndroidManifestApk(tempRoot, {
      fileName: 'ManifestDemo.apk',
      packageName: 'io.example.demo_manifest',
    });
    const adbProvider: AndroidAdbProvider = {
      exec: async (args) => {
        adbCalls.push([...args]);
        if (args[0] === 'shell' && args[1] === 'input' && args[2] === 'text') {
          searchText = String(args[3] ?? '').replaceAll('%s', ' ');
        }
        if (args.join(' ') === 'shell cmd clipboard set text android otp') {
          clipboardText = 'android otp';
        }
        return androidAdbResult(args, searchText, clipboardText);
      },
      install: async (apk, options) => {
        installCalls.push({ apkPath: apk, replace: options?.replace });
        return { stdout: '', stderr: '', exitCode: 0 };
      },
      spawn: (args) => {
        const child = makeMockAdbProcess();
        spawnedLogcat.push(child);
        child.stdout?.push(`I/AgentDevice(4242): ${args.join(' ')}\n`);
        return child;
      },
    };
    const daemon = await createDeviceLabHarness({
      androidAdbProvider: () => adbProvider,
      deviceInventoryProvider: async () => [DEVICE_LAB_ANDROID],
    });

    try {
      {
        const client = daemon.client();
        const selection = { platform: 'android' as const, serial: DEVICE_LAB_ANDROID.id };
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

        const keyboardDismiss = await client.command.keyboard({ action: 'dismiss', ...selection });
        assert.equal(keyboardDismiss.platform, 'android');
        assert.equal(keyboardDismiss.action, 'dismiss');
        assert.equal(keyboardDismiss.visible, false);
        assert.equal(keyboardDismiss.dismissed, false);

        const open = await client.apps.open({ app: 'settings', ...selection });
        assert.equal(open.device?.id, DEVICE_LAB_ANDROID.id);

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

        const network = await client.observability.network({
          action: 'dump',
          limit: 5,
          include: 'headers',
          ...selection,
        });
        assert.equal(network.active, true);
        assert.equal(network.backend, 'android');
        assert.ok(Array.isArray(network.entries), JSON.stringify(network));

        const perf = await client.observability.perf(selection);
        assert.equal(perf.platform, 'android');
        assert.equal(perf.deviceId, DEVICE_LAB_ANDROID.id);
        assert.equal(typeof perf.metrics, 'object');

        const logsStop = await client.observability.logs({ action: 'stop', ...selection });
        assert.equal(logsStop.stopped, true);

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

        await client.apps.close({});

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

      assertCommandCall(adbCalls, [
        'shell',
        'am',
        'start',
        '-W',
        '-a',
        'android.settings.SETTINGS',
      ]);
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
      assert.ok(
        spawnedLogcat.some((child) => child.killed),
        'Expected logs stop to terminate the scripted logcat stream',
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
      assert.deepEqual(readHostAdbCalls(hostAdbLogPath), []);
    } finally {
      restoreEnv('AGENT_DEVICE_ANDROID_APP_EVENT_URL_TEMPLATE', previousAppEventTemplate);
      fs.rmSync(tempRoot, { recursive: true, force: true });
      await daemon.close();
    }
  });
});

async function createAndroidManifestApk(
  tempRoot: string,
  options: { fileName: string; packageName: string },
): Promise<string> {
  const manifestDir = path.join(tempRoot, `${options.fileName}-payload`);
  await fs.promises.mkdir(manifestDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(manifestDir, 'AndroidManifest.xml'),
    `<manifest package="${options.packageName}" xmlns:android="http://schemas.android.com/apk/res/android" />`,
    'utf8',
  );
  const apkPath = path.join(tempRoot, options.fileName);
  const result = await runCmd('zip', ['-q', apkPath, 'AndroidManifest.xml'], {
    cwd: manifestDir,
    allowFailure: true,
  });
  assert.equal(result.exitCode, 0, `zip failed creating ${options.fileName}: ${result.stderr}`);
  return apkPath;
}

function androidAdbResult(
  args: string[],
  searchText: string,
  clipboardText: string,
): { stdout: string; stderr: string; exitCode: number; stdoutBuffer?: Buffer } {
  if (args.join(' ') === 'shell getprop sys.boot_completed') {
    return { stdout: '1\n', stderr: '', exitCode: 0 };
  }
  if (args.join(' ') === 'shell cmd clipboard get text') {
    return { stdout: `clipboard text: ${clipboardText}\n`, stderr: '', exitCode: 0 };
  }
  if (args.join(' ') === 'shell dumpsys input_method') {
    return { stdout: 'mInputShown=false inputType=0x1\n', stderr: '', exitCode: 0 };
  }
  if (args.join(' ') === 'shell pidof com.example.demo') {
    return { stdout: '4242\n', stderr: '', exitCode: 0 };
  }
  if (
    args.slice(0, 7).join(' ') ===
    'shell cmd package query-activities --brief -a android.intent.action.MAIN'
  ) {
    return {
      stdout: 'com.android.settings/.Settings\ncom.example.demo/.MainActivity\n',
      stderr: '',
      exitCode: 0,
    };
  }
  if (args.join(' ') === 'shell pm list packages -3') {
    return {
      stdout: 'package:com.example.demo\npackage:com.example.serviceonly\n',
      stderr: '',
      exitCode: 0,
    };
  }
  if (args.join(' ') === 'shell dumpsys window windows') {
    return {
      stdout: 'mCurrentFocus=Window{42 u0 com.android.settings/.Settings}\n',
      stderr: '',
      exitCode: 0,
    };
  }
  if (args.join(' ') === 'exec-out uiautomator dump /dev/tty') {
    return {
      stdout: androidSettingsXml(searchText),
      stderr: '',
      exitCode: 0,
    };
  }
  if (args.join(' ') === 'exec-out screencap -p') {
    return { stdout: '', stderr: '', exitCode: 0, stdoutBuffer: validPng() };
  }
  return { stdout: '', stderr: '', exitCode: 0 };
}

function androidSettingsXml(searchText: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<hierarchy rotation="0">',
    '  <node index="0" text="" resource-id="com.android.settings:id/main_content_scrollable_container" class="android.widget.ScrollView" package="com.android.settings" content-desc="" bounds="[0,0][390,600]" clickable="false" enabled="true">',
    '    <node index="0" text="Apps" resource-id="android:id/title" class="android.widget.TextView" package="com.android.settings" content-desc="" bounds="[24,124][152,178]" clickable="true" enabled="true" focusable="true" focused="false" />',
    `    <node index="1" text="${escapeXml(searchText)}" resource-id="com.android.settings:id/search" class="android.widget.EditText" package="com.android.settings" content-desc="Search" bounds="[16,24][374,80]" clickable="true" enabled="true" focusable="true" focused="true" password="false" />`,
    '  </node>',
    '</hierarchy>',
  ].join('\n');
}

async function withFakeHostAdbGuard(run: (argsLogPath: string) => Promise<void>): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-lab-adb-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'adb-args.log');
  fs.writeFileSync(
    adbPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$AGENT_DEVICE_TEST_ADB_ARGS_FILE"',
      'printf "host adb must not be used in Device Lab tests\\n" >&2',
      'exit 99',
      '',
    ].join('\n'),
    'utf8',
  );
  fs.chmodSync(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ADB_ARGS_FILE;
  const previousAuthHook = process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ADB_ARGS_FILE = argsLogPath;
  delete process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;

  try {
    await run(argsLogPath);
  } finally {
    process.env.PATH = previousPath;
    restoreEnv('AGENT_DEVICE_TEST_ADB_ARGS_FILE', previousArgsFile);
    restoreEnv('AGENT_DEVICE_HTTP_AUTH_HOOK', previousAuthHook);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function readHostAdbCalls(argsLogPath: string): string[] {
  if (!fs.existsSync(argsLogPath)) return [];
  return fs
    .readFileSync(argsLogPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function makeMockAdbProcess(): AndroidAdbProcess {
  const child = new EventEmitter() as EventEmitter & AndroidAdbProcess;
  child.stdin = null;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    if (child.killed) return false;
    child.killed = true;
    child.stdout?.push(null);
    child.stderr?.push(null);
    queueMicrotask(() => child.emit('close', 0, null));
    return true;
  };
  return child;
}
