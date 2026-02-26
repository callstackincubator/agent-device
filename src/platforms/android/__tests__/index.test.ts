import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dismissAndroidKeyboard,
  fillAndroid,
  getAndroidKeyboardState,
  inferAndroidAppName,
  isAmStartError,
  listAndroidApps,
  openAndroidApp,
  parseAndroidLaunchComponent,
  pushAndroidNotification,
  readAndroidClipboardText,
  setAndroidSetting,
  swipeAndroid,
  typeAndroid,
  writeAndroidClipboardText,
} from '../index.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';
import { findBounds, parseUiHierarchy } from '../ui-hierarchy.ts';

async function withMockedAdb(
  tempPrefix: string,
  script: string,
  run: (ctx: { argsLogPath: string; device: DeviceInfo }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), tempPrefix));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(adbPath, script, 'utf8');
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await run({ argsLogPath, device });
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

test('parseUiHierarchy reads double-quoted Android node attributes', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text="Hello" content-desc="Greeting" resource-id="com.demo:id/title" bounds="[10,20][110,60]" clickable="true" enabled="true"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
  assert.deepEqual(result.nodes[0].rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(result.nodes[0].hittable, true);
  assert.equal(result.nodes[0].enabled, true);
});

test('parseUiHierarchy reads single-quoted Android node attributes', () => {
  const xml =
    "<hierarchy><node class='android.widget.TextView' text='Hello' content-desc='Greeting' resource-id='com.demo:id/title' bounds='[10,20][110,60]' clickable='true' enabled='true'/></hierarchy>";

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
  assert.deepEqual(result.nodes[0].rect, { x: 10, y: 20, width: 100, height: 40 });
  assert.equal(result.nodes[0].hittable, true);
  assert.equal(result.nodes[0].enabled, true);
});

test('parseUiHierarchy supports mixed quote styles in one node', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text=\'Hello\' content-desc="Greeting" resource-id=\'com.demo:id/title\' bounds="[10,20][110,60]"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Hello');
  assert.equal(result.nodes[0].label, 'Hello');
  assert.equal(result.nodes[0].identifier, 'com.demo:id/title');
});

test('findBounds supports single and double quoted attributes', () => {
  const xml = [
    '<hierarchy>',
    '<node text="Nothing" content-desc="Irrelevant" bounds="[0,0][10,10]"/>',
    "<node text='Target from single quote' content-desc='Alt single' bounds='[100,200][300,500]'/>",
    '<node text="Target from double quote" content-desc="Alt double" bounds="[50,50][150,250]"/>',
    '</hierarchy>',
  ].join('');

  assert.deepEqual(findBounds(xml, 'single quote'), { x: 200, y: 350 });
  assert.deepEqual(findBounds(xml, 'alt double'), { x: 100, y: 150 });
});

test('parseUiHierarchy ignores attribute-name prefix spoofing', () => {
  const xml =
    "<hierarchy><node class='android.widget.TextView' hint-text='Spoofed' text='Actual' bounds='[10,20][110,60]'/></hierarchy>";

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Actual');
});

test('findBounds ignores bounds-like fragments inside other attribute values', () => {
  const xml = [
    '<hierarchy>',
    "<node text='Target' content-desc=\"metadata bounds='[900,900][1000,1000]'\" bounds='[100,200][300,500]'/>",
    '</hierarchy>',
  ].join('');

  assert.deepEqual(findBounds(xml, 'target'), { x: 200, y: 350 });
});

test('parseAndroidLaunchComponent extracts final resolved component', () => {
  const stdout = [
    'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
    'com.boatsgroup.boattrader/com.boatsgroup.boattrader.MainActivity',
  ].join('\n');
  assert.equal(
    parseAndroidLaunchComponent(stdout),
    'com.boatsgroup.boattrader/com.boatsgroup.boattrader.MainActivity',
  );
});

test('parseAndroidLaunchComponent returns null when no component is present', () => {
  const stdout = 'No activity found';
  assert.equal(parseAndroidLaunchComponent(stdout), null);
});

test('isAmStartError detects am start failure in stdout', () => {
  assert.equal(
    isAmStartError(
      'Starting: Intent { ... }\nError: Activity not started, unable to resolve Intent { ... }',
      '',
    ),
    true,
  );
});

test('isAmStartError returns false for successful am start', () => {
  assert.equal(
    isAmStartError('Status: ok\nLaunchState: COLD\nActivity: com.example/.MainActivity', ''),
    false,
  );
});

test('inferAndroidAppName derives readable names from package ids', () => {
  assert.equal(inferAndroidAppName('com.android.settings'), 'Settings');
  assert.equal(inferAndroidAppName('com.google.android.apps.maps'), 'Maps');
  assert.equal(inferAndroidAppName('org.mozilla.firefox'), 'Firefox');
  assert.equal(inferAndroidAppName('com.facebook.katana'), 'Katana');
  assert.equal(inferAndroidAppName('single'), 'Single');
  assert.equal(inferAndroidAppName('com.android.app.services'), 'Services');
});

test('listAndroidApps returns launchable apps with inferred names', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-apps-all-'));
  const adbPath = path.join(tmpDir, 'adb');
  await fs.writeFile(
    adbPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "package" ] && [ "$4" = "query-activities" ]; then',
      '  echo "com.google.android.apps.maps/.MainActivity"',
      '  echo "org.mozilla.firefox/.App"',
      '  echo "com.android.settings/.Settings"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ] && [ "$4" = "packages" ] && [ "$5" = "-3" ]; then',
      '  echo "package:com.google.android.apps.maps"',
      '  echo "package:com.example.serviceonly"',
      '  echo "package:org.mozilla.firefox"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    const apps = await listAndroidApps(device, 'all');
    assert.deepEqual(apps, [
      { package: 'com.android.settings', name: 'Settings' },
      { package: 'com.google.android.apps.maps', name: 'Maps' },
      { package: 'org.mozilla.firefox', name: 'Firefox' },
    ]);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('listAndroidApps user-installed excludes non-launchable packages', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-apps-user-'));
  const adbPath = path.join(tmpDir, 'adb');
  await fs.writeFile(
    adbPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "package" ] && [ "$4" = "query-activities" ]; then',
      '  echo "com.google.android.apps.maps/.MainActivity"',
      '  echo "org.mozilla.firefox/.App"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ] && [ "$4" = "packages" ] && [ "$5" = "-3" ]; then',
      '  echo "package:com.google.android.apps.maps"',
      '  echo "package:com.example.serviceonly"',
      '  echo "package:org.mozilla.firefox"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    const apps = await listAndroidApps(device, 'user-installed');
    assert.deepEqual(apps, [
      { package: 'com.google.android.apps.maps', name: 'Maps' },
      { package: 'org.mozilla.firefox', name: 'Firefox' },
    ]);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openAndroidApp rejects activity override for deep link URLs', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  await assert.rejects(
    () => openAndroidApp(device, '  https://example.com/path  ', '.MainActivity'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      return true;
    },
  );
});

test('setAndroidSetting appearance dark uses cmd uimode night yes', async () => {
  await withMockedAdb(
    'agent-device-android-appearance-dark-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'appearance', 'dark');
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /shell cmd uimode night yes/);
    },
  );
});

test('setAndroidSetting appearance toggle flips current mode', async () => {
  await withMockedAdb(
    'agent-device-android-appearance-toggle-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ] && [ "$4" = "cmd" ] && [ "$5" = "uimode" ] && [ "$6" = "night" ] && [ -z "$7" ]; then',
      '  echo "Night mode: yes"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'appearance', 'toggle');
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /shell cmd uimode night __CMD__/);
      assert.match(logged, /shell cmd uimode night no/);
    },
  );
});

test('setAndroidSetting appearance toggle from auto sets dark mode', async () => {
  await withMockedAdb(
    'agent-device-android-appearance-toggle-auto-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ] && [ "$4" = "cmd" ] && [ "$5" = "uimode" ] && [ "$6" = "night" ] && [ -z "$7" ]; then',
      '  echo "Night mode: auto"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'appearance', 'toggle');
      const lines = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /shell cmd uimode night yes/);
    },
  );
});

test('setAndroidSetting appearance toggle rejects unknown current mode output', async () => {
  await withMockedAdb(
    'agent-device-android-appearance-toggle-unknown-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ] && [ "$4" = "cmd" ] && [ "$5" = "uimode" ] && [ "$6" = "night" ] && [ -z "$7" ]; then',
      '  echo "mode unavailable"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ device }) => {
      await assert.rejects(
        () => setAndroidSetting(device, 'appearance', 'toggle'),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'COMMAND_FAILED');
          assert.match((error as AppError).message, /Unable to determine current Android appearance/);
          return true;
        },
      );
    },
  );
});

test('setAndroidSetting fingerprint match uses adb shell cmd fingerprint touch', async () => {
  await withMockedAdb(
    'agent-device-android-fingerprint-match-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'fingerprint', 'match');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ncmd\nfingerprint\ntouch\n1/);
    },
  );
});

test('setAndroidSetting fingerprint retries emulator command when shell cmd fingerprint fails', async () => {
  await withMockedAdb(
    'agent-device-android-fingerprint-fallback-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "fingerprint" ]; then',
      '  echo "fingerprint cmd unavailable" >&2',
      '  exit 1',
      'fi',
      'if [ "$1" = "emu" ] && [ "$2" = "finger" ] && [ "$3" = "touch" ] && [ "$4" = "1" ]; then',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'fingerprint', 'match');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ncmd\nfingerprint\ntouch\n1/);
      assert.match(logged, /shell\ncmd\nfingerprint\nfinger\n1/);
      assert.match(logged, /emu\nfinger\ntouch\n1/);
    },
  );
});

test('setAndroidSetting fingerprint rejects unsupported action', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  await assert.rejects(
    () => setAndroidSetting(device, 'fingerprint', 'enroll'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /Invalid fingerprint state/);
      return true;
    },
  );
});

test('setAndroidSetting fingerprint returns COMMAND_FAILED for transport/runtime failures', async () => {
  await withMockedAdb(
    'agent-device-android-fingerprint-command-failed-',
    [
      '#!/bin/sh',
      'echo "error: device offline" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      await assert.rejects(
        () => setAndroidSetting(device, 'fingerprint', 'match'),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'COMMAND_FAILED');
          assert.match((error as AppError).message, /Failed to simulate Android fingerprint/);
          return true;
        },
      );
    },
  );
});

test('setAndroidSetting fingerprint does not use adb emu command on physical devices', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-fingerprint-device-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\necho "unknown command" >&2\nexit 1\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'R5CT11',
    name: 'Pixel Device',
    kind: 'device',
    booted: true,
  };

  try {
    await assert.rejects(() => setAndroidSetting(device, 'fingerprint', 'match'));
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.doesNotMatch(logged, /\nemu\nfinger\ntouch\n/);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('swipeAndroid invokes adb input swipe with duration', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-swipe-test-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await swipeAndroid(device, 10, 20, 30, 40, 250);
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, ['-s', 'emulator-5554', 'shell', 'input', 'swipe', '10', '20', '30', '40', '250']);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('openAndroidApp default launch uses -p package flag', async () => {
  await withMockedAdb(
    'agent-device-android-open-default-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ]; then',
      '  echo "package:com.example.app"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "am" ] && [ "$3" = "start" ]; then',
      '  echo "Status: ok"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await openAndroidApp(device, 'com.example.app');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\nam\nstart\n-W\n-a\nandroid\.intent\.action\.MAIN/);
      assert.match(logged, /-p\ncom\.example\.app/);
    },
  );
});

test('openAndroidApp uses LEANBACK category for Android TV targets', async () => {
  await withMockedAdb(
    'agent-device-android-open-tv-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ]; then',
      '  echo "package:com.example.tvapp"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "am" ] && [ "$3" = "start" ]; then',
      '  echo "Status: ok"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      device.target = 'tv';
      await openAndroidApp(device, 'com.example.tvapp');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /-c\nandroid\.intent\.category\.LEANBACK_LAUNCHER/);
      assert.match(logged, /-p\ncom\.example\.tvapp/);
    },
  );
});

test('openAndroidApp fallback resolve-activity includes MAIN/LAUNCHER flags', async () => {
  await withMockedAdb(
    'agent-device-android-open-fallback-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ]; then',
      '  echo "package:com.microsoft.office.outlook"',
      '  exit 0',
      'fi',
      '# First am start (with -p) outputs error but exits 0 (real Android behavior)',
      'if [ "$1" = "shell" ] && [ "$2" = "am" ] && [ "$3" = "start" ]; then',
      '  for arg in "$@"; do',
      '    if [ "$arg" = "-p" ]; then',
      '      echo "Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.DEFAULT,android.intent.category.LAUNCHER] pkg=com.microsoft.office.outlook }"',
      '      echo "Error: Activity not started, unable to resolve Intent { act=android.intent.action.MAIN cat=[android.intent.category.DEFAULT,android.intent.category.LAUNCHER] flg=0x10000000 pkg=com.microsoft.office.outlook }"',
      '      exit 0',
      '    fi',
      '  done',
      '  echo "Status: ok"',
      '  exit 0',
      'fi',
      '# resolve-activity returns correct launcher component',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "package" ] && [ "$4" = "resolve-activity" ]; then',
      '  echo "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true"',
      '  echo "com.microsoft.office.outlook/com.microsoft.office.outlook.ui.miit.MiitLauncherActivity"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await openAndroidApp(device, 'com.microsoft.office.outlook');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      // Verify resolve-activity was called with MAIN/LAUNCHER flags
      assert.match(logged, /resolve-activity\n--brief\n-a\nandroid\.intent\.action\.MAIN\n-c\nandroid\.intent\.category\.LAUNCHER\ncom\.microsoft\.office\.outlook/);
      // Verify fallback launch used the resolved component
      assert.match(logged, /-n\ncom\.microsoft\.office\.outlook\/com\.microsoft\.office\.outlook\.ui\.miit\.MiitLauncherActivity/);
    },
  );
});

test('parseAndroidLaunchComponent handles multi-entry resolve output', () => {
  // Some devices return extra metadata lines before the component
  const stdout = [
    'priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true',
    'com.microsoft.office.outlook/com.microsoft.office.outlook.ui.miit.MiitLauncherActivity',
  ].join('\n');
  assert.equal(
    parseAndroidLaunchComponent(stdout),
    'com.microsoft.office.outlook/com.microsoft.office.outlook.ui.miit.MiitLauncherActivity',
  );
});

test('typeAndroid uses clipboard paste for unicode text', async () => {
  await withMockedAdb(
    'agent-device-android-type-unicode-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "clipboard" ] && [ "$4" = "set" ] && [ "$5" = "text" ]; then',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "KEYCODE_PASTE" ]; then',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "text" ]; then',
      '  echo "unexpected fallback to input text" >&2',
      '  exit 1',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await typeAndroid(device, '很 ☝ 😀');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ncmd\nclipboard\nset\ntext\n很 ☝ 😀/);
      assert.match(logged, /shell\ninput\nkeyevent\nKEYCODE_PASTE/);
      assert.doesNotMatch(logged, /shell\ninput\ntext/);
    },
  );
});

test('typeAndroid uses adb input text for ascii text', async () => {
  await withMockedAdb(
    'agent-device-android-type-ascii-',
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await typeAndroid(device, 'hello world');
      const args = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      assert.deepEqual(args, [
        '-s',
        'emulator-5554',
        'shell',
        'input',
        'text',
        'hello%sworld',
      ]);
    },
  );
});

test('typeAndroid passes shell-sensitive ascii text to adb input text', async () => {
  await withMockedAdb(
    'agent-device-android-type-ascii-special-',
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await typeAndroid(device, 'curtis.layne+test+73kmc@uber.com');
      const args = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      assert.deepEqual(args, [
        '-s',
        'emulator-5554',
        'shell',
        'input',
        'text',
        'curtis.layne+test+73kmc@uber.com',
      ]);
    },
  );
});

test('typeAndroid preserves percent signs while encoding spaces', async () => {
  await withMockedAdb(
    'agent-device-android-type-ascii-percent-',
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await typeAndroid(device, '50% complete');
      const args = (await fs.readFile(argsLogPath, 'utf8'))
        .trim()
        .split('\n')
        .filter(Boolean);
      assert.deepEqual(args, [
        '-s',
        'emulator-5554',
        'shell',
        'input',
        'text',
        '50%%scomplete',
      ]);
    },
  );
});

test('fillAndroid falls back to clipboard paste when adb input text truncates', async () => {
  await withMockedAdb(
    'agent-device-android-fill-fallback-',
    [
      '#!/bin/sh',
      'STATE_FILE="$(dirname "$AGENT_DEVICE_TEST_ARGS_FILE")/fill_state.txt"',
      'CLIP_FILE="$(dirname "$AGENT_DEVICE_TEST_ARGS_FILE")/clipboard_state.txt"',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "tap" ]; then',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "KEYCODE_MOVE_END" ]; then',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "KEYCODE_DEL" ]; then',
      '  : > "$STATE_FILE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "text" ]; then',
      '  # Simulate WebView truncation on shell text input with special chars.',
      '  if [ "$4" = "curtis.layne+test+73kmc@uber.com" ]; then',
      '    printf "curti" > "$STATE_FILE"',
      '  else',
      '    printf "%s" "$4" > "$STATE_FILE"',
      '  fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "clipboard" ] && [ "$4" = "set" ] && [ "$5" = "text" ]; then',
      '  printf "%s" "$6" > "$CLIP_FILE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "KEYCODE_PASTE" ]; then',
      '  cat "$CLIP_FILE" > "$STATE_FILE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "279" ]; then',
      '  cat "$CLIP_FILE" > "$STATE_FILE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "exec-out" ] && [ "$2" = "uiautomator" ] && [ "$3" = "dump" ] && [ "$4" = "/dev/tty" ]; then',
      '  text="$(cat "$STATE_FILE" 2>/dev/null)"',
      '  printf "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?><hierarchy><node class=\\"android.widget.EditText\\" text=\\"%s\\" focused=\\"true\\" bounds=\\"[0,0][200,100]\\"/></hierarchy>" "$text"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await fillAndroid(device, 10, 10, 'curtis.layne+test+73kmc@uber.com');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ninput\ntext\ncurtis\.layne\+test\+73kmc@uber\.com/);
      assert.match(logged, /shell\ncmd\nclipboard\nset\ntext\ncurtis\.layne\+test\+73kmc@uber\.com/);
      assert.match(logged, /shell\ninput\nkeyevent\nKEYCODE_PASTE/);
      const shellInputTextCount = (logged.match(/shell\ninput\ntext\n/g) ?? []).length;
      assert.equal(shellInputTextCount, 1);
    },
  );
});

test('typeAndroid reports clear error when unicode input is unsupported', async () => {
  await withMockedAdb(
    'agent-device-android-type-unicode-unsupported-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "clipboard" ] && [ "$4" = "set" ] && [ "$5" = "text" ]; then',
      '  echo "No shell command implementation."',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "text" ]; then',
      "  echo \"Exception occurred while executing 'text':\" >&2",
      '  echo "java.lang.NullPointerException" >&2',
      '  exit 255',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      await assert.rejects(
        () => typeAndroid(device, '很'),
        (error: unknown) => {
          assert.equal(error instanceof AppError, true);
          assert.equal((error as AppError).code, 'COMMAND_FAILED');
          assert.match((error as AppError).message, /non-ascii text input is not supported/i);
          return true;
        },
      );
    },
  );
});

test('writeAndroidClipboardText uses adb cmd clipboard set text', async () => {
  await withMockedAdb(
    'agent-device-android-clipboard-write-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await writeAndroidClipboardText(device, 'hello otp');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ncmd\nclipboard\nset\ntext\nhello otp/);
    },
  );
});

test('readAndroidClipboardText uses adb cmd clipboard get text', async () => {
  await withMockedAdb(
    'agent-device-android-clipboard-read-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "cmd" ] && [ "$3" = "clipboard" ] && [ "$4" = "get" ] && [ "$5" = "text" ]; then',
      '  echo "copied-value"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      const text = await readAndroidClipboardText(device);
      assert.equal(text, 'copied-value');
    },
  );
});

test('getAndroidKeyboardState reads visibility and input type', async () => {
  await withMockedAdb(
    'agent-device-android-keyboard-state-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "input_method" ]; then',
      '  echo "mInputShown=true mIsInputViewShown=true"',
      '  echo "inputType=0x21 imeOptions=0x12000000 privateImeOptions=null"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      const state = await getAndroidKeyboardState(device);
      assert.equal(state.visible, true);
      assert.equal(state.inputType, '0x21');
      assert.equal(state.type, 'email');
    },
  );
});

test('getAndroidKeyboardState falls back to mImeWindowVis flag', async () => {
  await withMockedAdb(
    'agent-device-android-keyboard-window-vis-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "input_method" ]; then',
      '  echo "mImeWindowVis=0x1"',
      '  echo "inputType=0x2"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      const state = await getAndroidKeyboardState(device);
      assert.equal(state.visible, true);
      assert.equal(state.inputType, '0x2');
      assert.equal(state.type, 'number');
    },
  );
});

test('getAndroidKeyboardState uses latest visibility value when dumpsys contains duplicates', async () => {
  await withMockedAdb(
    'agent-device-android-keyboard-duplicate-visibility-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "input_method" ]; then',
      '  echo "mInputShown=true"',
      '  echo "mInputShown=false"',
      '  echo "mIsInputViewShown=false"',
      '  echo "inputType=0x21"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      const state = await getAndroidKeyboardState(device);
      assert.equal(state.visible, false);
      assert.equal(state.inputType, '0x21');
      assert.equal(state.type, 'email');
    },
  );
});

test('dismissAndroidKeyboard skips keyevent when keyboard is already hidden', async () => {
  await withMockedAdb(
    'agent-device-android-keyboard-dismiss-hidden-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "input_method" ]; then',
      '  echo "mInputShown=false mIsInputViewShown=false"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "4" ]; then',
      '  echo "unexpected keyevent" >&2',
      '  exit 1',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      const result = await dismissAndroidKeyboard(device);
      assert.equal(result.attempts, 0);
      assert.equal(result.wasVisible, false);
      assert.equal(result.dismissed, false);
      assert.equal(result.visible, false);

      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.doesNotMatch(logged, /shell\ninput\nkeyevent\n4/);
    },
  );
});

test('dismissAndroidKeyboard sends back keyevent and confirms hidden state', async () => {
  await withMockedAdb(
    'agent-device-android-keyboard-dismiss-visible-',
    [
      '#!/bin/sh',
      'STATE_FILE="$(dirname "$AGENT_DEVICE_TEST_ARGS_FILE")/keyboard_hidden.txt"',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "input_method" ]; then',
      '  if [ -f "$STATE_FILE" ]; then',
      '    echo "mInputShown=false mIsInputViewShown=false"',
      '    exit 0',
      '  fi',
      '  echo "mInputShown=true mIsInputViewShown=true"',
      '  echo "inputType=0x2"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "4" ]; then',
      '  touch "$STATE_FILE"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      const result = await dismissAndroidKeyboard(device);
      assert.equal(result.attempts, 1);
      assert.equal(result.wasVisible, true);
      assert.equal(result.dismissed, true);
      assert.equal(result.visible, false);

      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ndumpsys\ninput_method/);
      assert.match(logged, /shell\ninput\nkeyevent\n4/);
    },
  );
});

test('setAndroidSetting permission grant camera uses pm grant', async () => {
  await withMockedAdb(
    'agent-device-android-permission-camera-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'camera',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\npm\ngrant\ncom\.example\.app\nandroid\.permission\.CAMERA/);
    },
  );
});

test('setAndroidSetting permission deny notifications revokes runtime permission and appops', async () => {
  await withMockedAdb(
    'agent-device-android-permission-notifications-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'permission', 'deny', 'com.example.app', {
        permissionTarget: 'notifications',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\npm\nrevoke\ncom\.example\.app\nandroid\.permission\.POST_NOTIFICATIONS/);
      assert.match(logged, /shell\nappops\nset\ncom\.example\.app\nPOST_NOTIFICATION\ndeny/);
    },
  );
});

test('setAndroidSetting permission reset notifications clears permission flags for reprompt', async () => {
  await withMockedAdb(
    'agent-device-android-permission-notifications-reset-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'permission', 'reset', 'com.example.app', {
        permissionTarget: 'notifications',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\npm\nrevoke\ncom\.example\.app\nandroid\.permission\.POST_NOTIFICATIONS/);
      assert.match(
        logged,
        /shell\npm\nclear-permission-flags\ncom\.example\.app\nandroid\.permission\.POST_NOTIFICATIONS\nuser-set/,
      );
      assert.match(
        logged,
        /shell\npm\nclear-permission-flags\ncom\.example\.app\nandroid\.permission\.POST_NOTIFICATIONS\nuser-fixed/,
      );
      assert.match(logged, /shell\nappops\nset\ncom\.example\.app\nPOST_NOTIFICATION\ndefault/);
    },
  );
});

test('setAndroidSetting permission reset camera maps to pm revoke', async () => {
  await withMockedAdb(
    'agent-device-android-permission-reset-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'permission', 'reset', 'com.example.app', {
        permissionTarget: 'camera',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\npm\nrevoke\ncom\.example\.app\nandroid\.permission\.CAMERA/);
    },
  );
});

test('setAndroidSetting permission rejects mode argument', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  await assert.rejects(
    () =>
      setAndroidSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'camera',
        permissionMode: 'limited',
      }),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /mode is only supported for photos/i);
      return true;
    },
  );
});

test('setAndroidSetting permission rejects iOS-only targets with Android-specific guidance', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };
  await assert.rejects(
    () =>
      setAndroidSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'calendar',
      }),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /Unsupported permission target on Android/i);
      return true;
    },
  );
});

test('setAndroidSetting permission grant photos falls back to legacy permission on older SDK', async () => {
  await withMockedAdb(
    'agent-device-android-permission-photos-fallback-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "getprop" ] && [ "$3" = "ro.build.version.sdk" ]; then',
      '  echo "32"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "grant" ] && [ "$5" = "android.permission.READ_EXTERNAL_STORAGE" ]; then',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await setAndroidSetting(device, 'permission', 'grant', 'com.example.app', {
        permissionTarget: 'photos',
      });
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ngetprop\nro\.build\.version\.sdk/);
      assert.match(logged, /shell\npm\ngrant\ncom\.example\.app\nandroid\.permission\.READ_EXTERNAL_STORAGE/);
    },
  );
});

test('pushAndroidNotification broadcasts action with typed extras', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-push-test-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    const result = await pushAndroidNotification(device, 'com.example.app', {
      action: 'com.example.app.PUSH',
      extras: {
        title: 'Hello',
        unread: 3,
        promo: true,
        ratio: 0.5,
      },
    });
    assert.equal(result.action, 'com.example.app.PUSH');
    assert.equal(result.extrasCount, 4);
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, [
      '-s',
      'emulator-5554',
      'shell',
      'am',
      'broadcast',
      '-a',
      'com.example.app.PUSH',
      '-p',
      'com.example.app',
      '--es',
      'title',
      'Hello',
      '--ei',
      'unread',
      '3',
      '--ez',
      'promo',
      'true',
      '--ef',
      'ratio',
      '0.5',
    ]);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('pushAndroidNotification ignores empty extra keys when reporting extrasCount', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-push-empty-key-test-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    const result = await pushAndroidNotification(device, 'com.example.app', {
      extras: {
        '': 'ignored',
        title: 'Welcome',
      },
    });
    assert.equal(result.extrasCount, 1);
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim();
    assert.equal(args.includes('\n\n'), false);
    assert.equal(args.includes('ignored'), false);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
