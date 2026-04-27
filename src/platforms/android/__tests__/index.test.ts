import { test } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  dismissAndroidKeyboard,
  fillAndroid,
  getAndroidKeyboardState,
  inferAndroidAppName,
  installAndroidApp,
  isAmStartError,
  listAndroidApps,
  openAndroidApp,
  parseAndroidLaunchComponent,
  resolveAndroidApp,
  pushAndroidNotification,
  readAndroidClipboardText,
  rotateAndroid,
  setAndroidSetting,
  scrollAndroid,
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

test('parseUiHierarchy decodes XML entities in Android node attributes', () => {
  const xml =
    '<hierarchy><node class="android.widget.TextView" text="Line 1&#10;Line 2&#9;&amp;&lt;&gt;&quot;&apos;" bounds="[0,0][10,10]"/></hierarchy>';

  const result = parseUiHierarchy(xml, 800, { raw: true });
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].value, 'Line 1\nLine 2\t&<>"\'');
  assert.equal(result.nodes[0].label, 'Line 1\nLine 2\t&<>"\'');
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

test('scrollAndroid supports explicit pixel travel distance', async () => {
  await withMockedAdb(
    'agent-device-android-scroll-pixels-',
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "wm" ] && [ "$3" = "size" ]; then',
      '  echo "Physical size: 1080x1920"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      const result = await scrollAndroid(device, 'down', { pixels: 240 });
      const args = await fs.readFile(argsLogPath, 'utf8');

      assert.match(args, /shell\ninput\nswipe\n540\n1080\n540\n840\n300\n/);
      assert.equal(result.pixels, 240);
      assert.equal(result.referenceWidth, 1080);
      assert.equal(result.referenceHeight, 1920);
    },
  );
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

test('installAndroidApp installs .apk via adb install -r', async () => {
  const apkPath = path.join(os.tmpdir(), `agent-device-test-${Date.now()}.apk`);
  await fs.writeFile(apkPath, 'placeholder', 'utf8');
  await withMockedAdb(
    'agent-device-android-install-apk-',
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await installAndroidApp(device, apkPath);
      const logged = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').join(' ');
      assert.match(logged, /install -r .*agent-device-test-.*\.apk/);
    },
  );
  await fs.rm(apkPath, { force: true });
});

test('installAndroidApp resolves packageName and launchTarget from nested archive artifacts', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-install-archive-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const installMarkerPath = path.join(tmpDir, 'installed.marker');
  const archivePath = path.join(tmpDir, 'Sample.zip');
  const manifestDir = path.join(tmpDir, 'manifest');
  const nestedDir = path.join(tmpDir, 'nested');
  await fs.mkdir(manifestDir);
  await fs.mkdir(nestedDir);
  await fs.writeFile(
    path.join(manifestDir, 'AndroidManifest.xml'),
    '<manifest package="com.example.archive" />',
    'utf8',
  );
  execFileSync('zip', ['-qr', path.join(nestedDir, 'Sample.apk'), 'AndroidManifest.xml'], {
    cwd: manifestDir,
  });
  execFileSync('zip', ['-qr', archivePath, 'nested'], { cwd: tmpDir });

  await fs.writeFile(
    adbPath,
    [
      '#!/bin/sh',
      'printf "adb %s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ] && [ "$4" = "packages" ]; then',
      `  if [ -f "${installMarkerPath}" ]; then`,
      '    echo "package:com.example.archive"',
      '  fi',
      '  exit 0',
      'fi',
      'if [ "$1" = "install" ] && [ "$2" = "-r" ]; then',
      `  : > "${installMarkerPath}"`,
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
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
    const result = await installAndroidApp(device, archivePath);
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.equal(result.archivePath, archivePath);
    assert.equal(result.packageName, 'com.example.archive');
    assert.equal(result.appName, 'Archive');
    assert.equal(result.launchTarget, 'com.example.archive');
    assert.equal(result.installablePath.endsWith('/nested/Sample.apk'), true);
    assert.match(logged, /adb -s emulator-5554 install -r .*nested\/Sample\.apk/);
    assert.doesNotMatch(logged, /adb -s emulator-5554 shell pm list packages/);
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

test('installAndroidApp installs .aab via bundletool build-apks + install-apks', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-install-aab-'));
  const adbPath = path.join(tmpDir, 'adb');
  const bundletoolPath = path.join(tmpDir, 'bundletool');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const aabPath = path.join(tmpDir, 'Sample.aab');
  await fs.writeFile(aabPath, 'placeholder', 'utf8');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "adb %s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);
  await fs.writeFile(
    bundletoolPath,
    [
      '#!/bin/sh',
      'printf "bundletool %s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "build-apks" ]; then',
      '  out=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--output" ]; then',
      '      out="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      '  mkdir -p "$(dirname "$out")"',
      '  printf "apks" > "$out"',
      '  exit 0',
      'fi',
      'if [ "$1" = "install-apks" ]; then',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(bundletoolPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  const previousBundletoolJar = process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
  delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await installAndroidApp(device, aabPath);
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.match(logged, /bundletool build-apks .*--bundle .*Sample\.aab .*--mode universal/);
    assert.match(logged, /bundletool install-apks .*--device-id emulator-5554/);
    assert.doesNotMatch(logged, /adb .* install -r/);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    if (previousBundletoolJar === undefined) {
      delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
    } else {
      process.env.AGENT_DEVICE_BUNDLETOOL_JAR = previousBundletoolJar;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installAndroidApp honors AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE for .aab installs', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-android-install-aab-mode-'));
  const adbPath = path.join(tmpDir, 'adb');
  const bundletoolPath = path.join(tmpDir, 'bundletool');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const aabPath = path.join(tmpDir, 'Sample.aab');
  await fs.writeFile(aabPath, 'placeholder', 'utf8');
  await fs.writeFile(
    adbPath,
    '#!/bin/sh\nprintf "adb %s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(adbPath, 0o755);
  await fs.writeFile(
    bundletoolPath,
    [
      '#!/bin/sh',
      'printf "bundletool %s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "build-apks" ]; then',
      '  out=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--output" ]; then',
      '      out="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      '  mkdir -p "$(dirname "$out")"',
      '  printf "apks" > "$out"',
      '  exit 0',
      'fi',
      'if [ "$1" = "install-apks" ]; then',
      '  exit 0',
      'fi',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(bundletoolPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  const previousBundletoolJar = process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
  const previousBundletoolMode = process.env.AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
  process.env.AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE = 'default';
  delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await installAndroidApp(device, aabPath);
    const logged = await fs.readFile(argsLogPath, 'utf8');
    assert.match(logged, /bundletool build-apks .*--mode default/);
  } finally {
    process.env.PATH = previousPath;
    if (previousArgsFile === undefined) {
      delete process.env.AGENT_DEVICE_TEST_ARGS_FILE;
    } else {
      process.env.AGENT_DEVICE_TEST_ARGS_FILE = previousArgsFile;
    }
    if (previousBundletoolJar === undefined) {
      delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
    } else {
      process.env.AGENT_DEVICE_BUNDLETOOL_JAR = previousBundletoolJar;
    }
    if (previousBundletoolMode === undefined) {
      delete process.env.AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE;
    } else {
      process.env.AGENT_DEVICE_ANDROID_BUNDLETOOL_MODE = previousBundletoolMode;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installAndroidApp .aab reports missing bundletool tooling', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-android-install-aab-missing-tool-'),
  );
  const adbPath = path.join(tmpDir, 'adb');
  const aabPath = path.join(tmpDir, 'Sample.aab');
  await fs.writeFile(aabPath, 'placeholder', 'utf8');
  await fs.writeFile(adbPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousBundletoolJar = process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await assert.rejects(
      () => installAndroidApp(device, aabPath),
      (error: unknown) => {
        assert.equal(error instanceof AppError, true);
        assert.equal((error as AppError).code, 'TOOL_MISSING');
        assert.match((error as AppError).message, /bundletool/i);
        return true;
      },
    );
  } finally {
    process.env.PATH = previousPath;
    if (previousBundletoolJar === undefined) {
      delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
    } else {
      process.env.AGENT_DEVICE_BUNDLETOOL_JAR = previousBundletoolJar;
    }
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('installAndroidApp .aab rejects relative AGENT_DEVICE_BUNDLETOOL_JAR overrides', async () => {
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-android-install-aab-relative-jar-'),
  );
  const adbPath = path.join(tmpDir, 'adb');
  const aabPath = path.join(tmpDir, 'Sample.aab');
  await fs.writeFile(aabPath, 'placeholder', 'utf8');
  await fs.writeFile(adbPath, '#!/bin/sh\nexit 0\n', 'utf8');
  await fs.chmod(adbPath, 0o755);

  const previousPath = process.env.PATH;
  const previousBundletoolJar = process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
  process.env.PATH = tmpDir;
  process.env.AGENT_DEVICE_BUNDLETOOL_JAR = './bundletool-all.jar';

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await assert.rejects(() => installAndroidApp(device, aabPath), { code: 'INVALID_ARGS' });
  } finally {
    process.env.PATH = previousPath;
    if (previousBundletoolJar === undefined) {
      delete process.env.AGENT_DEVICE_BUNDLETOOL_JAR;
    } else {
      process.env.AGENT_DEVICE_BUNDLETOOL_JAR = previousBundletoolJar;
    }
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
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
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
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
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
          assert.match(
            (error as AppError).message,
            /Unable to determine current Android appearance/,
          );
          return true;
        },
      );
    },
  );
});

test('rotateAndroid locks auto-rotate and sets user rotation', async () => {
  await withMockedAdb(
    'agent-device-android-rotate-landscape-left-',
    '#!/bin/sh\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await rotateAndroid(device, 'landscape-left');
      const lines = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      const logged = lines.join(' ');
      assert.match(logged, /shell settings put system accelerometer_rotation 0/);
      assert.match(logged, /shell settings put system user_rotation 1/);
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
    ['#!/bin/sh', 'echo "error: device offline" >&2', 'exit 1', ''].join('\n'),
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
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-android-fingerprint-device-'),
  );
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
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
    assert.deepEqual(args, [
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'swipe',
      '10',
      '20',
      '30',
      '40',
      '250',
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

test('resolveAndroidApp does not treat file paths as package names', async () => {
  await withMockedAdb(
    'agent-device-android-resolve-path-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then shift; shift; fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "list" ]; then',
      '  echo "package:com.example.demo"',
      '  exit 0',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ device }) => {
      await assert.rejects(
        resolveAndroidApp(device, '/path/to/app-debug.apk'),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'APP_NOT_INSTALLED');
          return true;
        },
      );
    },
  );
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

test('openAndroidApp normalizes missing package launch failures into APP_NOT_INSTALLED', async () => {
  await withMockedAdb(
    'agent-device-android-open-missing-package-',
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "am" ] && [ "$3" = "start" ]; then',
      '  echo "Error: Activity class does not exist." >&2',
      '  exit 1',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "pm" ] && [ "$3" = "path" ]; then',
      '  echo "Error: unknown package: com.example.missing" >&2',
      '  exit 1',
      'fi',
      'exit 0',
      '',
    ].join('\n'),
    async ({ device }) => {
      await assert.rejects(
        openAndroidApp(device, 'com.example.missing', '.MainActivity'),
        (error: unknown) => {
          assert.ok(error instanceof AppError);
          assert.equal(error.code, 'APP_NOT_INSTALLED');
          assert.match(String(error.details?.hint ?? ''), /agent-device apps --platform android/);
          return true;
        },
      );
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
      assert.match(
        logged,
        /resolve-activity\n--brief\n-a\nandroid\.intent\.action\.MAIN\n-c\nandroid\.intent\.category\.LAUNCHER\ncom\.microsoft\.office\.outlook/,
      );
      // Verify fallback launch used the resolved component
      assert.match(
        logged,
        /-n\ncom\.microsoft\.office\.outlook\/com\.microsoft\.office\.outlook\.ui\.miit\.MiitLauncherActivity/,
      );
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
      const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      assert.deepEqual(args, ['-s', 'emulator-5554', 'shell', 'input', 'text', 'hello%sworld']);
    },
  );
});

test('typeAndroid passes shell-sensitive ascii text to adb input text', async () => {
  await withMockedAdb(
    'agent-device-android-type-ascii-special-',
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      await typeAndroid(device, 'curtis.layne+test+73kmc@uber.com');
      const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
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
      const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
      assert.deepEqual(args, ['-s', 'emulator-5554', 'shell', 'input', 'text', '50%%scomplete']);
    },
  );
});

test('typeAndroid sends one character at a time when delay is requested', async () => {
  await withMockedAdb(
    'agent-device-android-type-delayed-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'exit 0',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await typeAndroid(device, 'hey', 1);
      const logged = await fs.readFile(argsLogPath, 'utf8');
      const shellInputTextCount = (logged.match(/shell\ninput\ntext\n/g) ?? []).length;
      assert.equal(shellInputTextCount, 3);
      assert.match(logged, /shell\ninput\ntext\nh/);
      assert.match(logged, /shell\ninput\ntext\ne/);
      assert.match(logged, /shell\ninput\ntext\ny/);
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
      assert.match(
        logged,
        /shell\ncmd\nclipboard\nset\ntext\ncurtis\.layne\+test\+73kmc@uber\.com/,
      );
      assert.match(logged, /shell\ninput\nkeyevent\nKEYCODE_PASTE/);
      const shellInputTextCount = (logged.match(/shell\ninput\ntext\n/g) ?? []).length;
      assert.equal(shellInputTextCount, 1);
    },
  );
});

test('fillAndroid keeps delayed typing in typed-input mode', async () => {
  await withMockedAdb(
    'agent-device-android-fill-delayed-',
    [
      '#!/bin/sh',
      'STATE_FILE="$(dirname "$AGENT_DEVICE_TEST_ARGS_FILE")/fill_state.txt"',
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
      '  printf "%s" "$4" >> "$STATE_FILE"',
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
      await fillAndroid(device, 10, 10, 'go', 1);
      const logged = await fs.readFile(argsLogPath, 'utf8');
      const shellInputTextCount = (logged.match(/shell\ninput\ntext\n/g) ?? []).length;
      assert.equal(shellInputTextCount, 2);
      assert.doesNotMatch(logged, /shell\ncmd\nclipboard\nset\ntext/);
      assert.doesNotMatch(logged, /shell\ninput\nkeyevent\nKEYCODE_PASTE/);
    },
  );
});

test('fillAndroid tolerates delayed React Native text verification', async () => {
  await withMockedAdb(
    'agent-device-android-fill-delayed-verify-',
    [
      '#!/bin/sh',
      'STATE_FILE="$(dirname "$AGENT_DEVICE_TEST_ARGS_FILE")/fill_state.txt"',
      'DUMP_COUNT_FILE="$(dirname "$AGENT_DEVICE_TEST_ARGS_FILE")/dump_count.txt"',
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
      '  printf "%s" "$4" > "$STATE_FILE"',
      '  exit 0',
      'fi',
      'if [ "$1" = "exec-out" ] && [ "$2" = "uiautomator" ] && [ "$3" = "dump" ] && [ "$4" = "/dev/tty" ]; then',
      '  count="$(cat "$DUMP_COUNT_FILE" 2>/dev/null || echo 0)"',
      '  count=$((count + 1))',
      '  printf "%s" "$count" > "$DUMP_COUNT_FILE"',
      '  if [ "$count" -eq 1 ]; then',
      '    text="filed the expens"',
      '  else',
      '    text="$(cat "$STATE_FILE" 2>/dev/null)"',
      '  fi',
      '  printf "<?xml version=\\"1.0\\" encoding=\\"UTF-8\\"?><hierarchy><node class=\\"android.widget.EditText\\" text=\\"%s\\" focused=\\"true\\" bounds=\\"[0,0][200,100]\\"/></hierarchy>" "$text"',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ device }) => {
      await fillAndroid(device, 10, 10, 'filed the expense');
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
      '  echo "Exception occurred while executing \'text\':" >&2',
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
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "111" ]; then',
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
      assert.doesNotMatch(logged, /shell\ninput\nkeyevent\n111/);
    },
  );
});

test('dismissAndroidKeyboard sends escape keyevent and confirms hidden state', async () => {
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
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "111" ]; then',
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
      assert.match(logged, /shell\ninput\nkeyevent\n111/);
    },
  );
});

test('dismissAndroidKeyboard fails explicitly when non-navigation dismiss does not hide the keyboard', async () => {
  await withMockedAdb(
    'agent-device-android-keyboard-dismiss-unsupported-',
    [
      '#!/bin/sh',
      'printf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ] && [ "$3" = "input_method" ]; then',
      '  echo "mInputShown=true mIsInputViewShown=true"',
      '  echo "inputType=0x1"',
      '  exit 0',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "input" ] && [ "$3" = "keyevent" ] && [ "$4" = "111" ]; then',
      '  exit 0',
      'fi',
      'echo "unexpected args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    async ({ argsLogPath, device }) => {
      await assert.rejects(
        dismissAndroidKeyboard(device),
        (error: unknown) =>
          error instanceof AppError &&
          error.code === 'UNSUPPORTED_OPERATION' &&
          /without back navigation/i.test(error.message),
      );

      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\ninput\nkeyevent\n111/);
      assert.doesNotMatch(logged, /shell\ninput\nkeyevent\n4/);
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

test('setAndroidSetting animations off disables global animation scales', async () => {
  await withMockedAdb(
    'agent-device-android-animations-',
    '#!/bin/sh\nprintf "__CMD__\\n" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nprintf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    async ({ argsLogPath, device }) => {
      const result = await setAndroidSetting(device, 'animations', 'off');
      const logged = await fs.readFile(argsLogPath, 'utf8');
      assert.match(logged, /shell\nsettings\nput\nglobal\nwindow_animation_scale\n0/);
      assert.match(logged, /shell\nsettings\nput\nglobal\ntransition_animation_scale\n0/);
      assert.match(logged, /shell\nsettings\nput\nglobal\nanimator_duration_scale\n0/);
      assert.deepEqual(result, {
        scale: '0',
        keys: ['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale'],
      });
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
      assert.match(
        logged,
        /shell\npm\nrevoke\ncom\.example\.app\nandroid\.permission\.POST_NOTIFICATIONS/,
      );
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
      assert.match(
        logged,
        /shell\npm\nrevoke\ncom\.example\.app\nandroid\.permission\.POST_NOTIFICATIONS/,
      );
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
      assert.match(
        logged,
        /shell\npm\ngrant\ncom\.example\.app\nandroid\.permission\.READ_EXTERNAL_STORAGE/,
      );
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
    const args = (await fs.readFile(argsLogPath, 'utf8')).trim().split('\n').filter(Boolean);
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
  const tmpDir = await fs.mkdtemp(
    path.join(os.tmpdir(), 'agent-device-android-push-empty-key-test-'),
  );
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
