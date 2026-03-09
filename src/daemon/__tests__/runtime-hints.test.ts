import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  applyRuntimeHintsToApp,
  clearRuntimeHintsFromApp,
  resolveRuntimeTransportHints,
} from '../runtime-hints.ts';
import type { DeviceInfo } from '../../utils/device.ts';

async function withMockedAdb(
  run: (ctx: {
    device: DeviceInfo;
    argsLogPath: string;
    readFilePath: string;
    scriptFilePath: string;
  }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-runtime-hints-android-'));
  const adbPath = path.join(tmpDir, 'adb');
  const argsLogPath = path.join(tmpDir, 'args.log');
  const readFilePath = path.join(tmpDir, 'existing.xml');
  const scriptFilePath = path.join(tmpDir, 'write-script.sh');
  await fs.writeFile(
    adbPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "-s" ]; then',
      '  shift',
      '  shift',
      'fi',
      'printf "%s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "shell" ] && [ "$2" = "run-as" ] && [ "$4" = "cat" ]; then',
      '  if [ -f "$AGENT_DEVICE_TEST_READ_FILE" ]; then',
      '    cat "$AGENT_DEVICE_TEST_READ_FILE"',
      '    exit 0',
      '  fi',
      '  exit 1',
      'fi',
      'if [ "$1" = "shell" ] && [ "$2" = "run-as" ] && [ "$4" = "sh" ] && [ "$5" = "-c" ]; then',
      '  printf "%s" "$6" > "$AGENT_DEVICE_TEST_SCRIPT_FILE"',
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
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  const previousReadFile = process.env.AGENT_DEVICE_TEST_READ_FILE;
  const previousScriptFile = process.env.AGENT_DEVICE_TEST_SCRIPT_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;
  process.env.AGENT_DEVICE_TEST_READ_FILE = readFilePath;
  process.env.AGENT_DEVICE_TEST_SCRIPT_FILE = scriptFilePath;

  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  try {
    await run({ device, argsLogPath, readFilePath, scriptFilePath });
  } finally {
    process.env.PATH = previousPath;
    restoreEnv('AGENT_DEVICE_TEST_ARGS_FILE', previousArgsFile);
    restoreEnv('AGENT_DEVICE_TEST_READ_FILE', previousReadFile);
    restoreEnv('AGENT_DEVICE_TEST_SCRIPT_FILE', previousScriptFile);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

async function withMockedXcrun(
  run: (ctx: { device: DeviceInfo; argsLogPath: string }) => Promise<void>,
): Promise<void> {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-runtime-hints-ios-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'exit 0',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    booted: true,
  };

  try {
    await run({ device, argsLogPath });
  } finally {
    process.env.PATH = previousPath;
    restoreEnv('AGENT_DEVICE_TEST_ARGS_FILE', previousArgsFile);
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

test('resolveRuntimeTransportHints derives host, port, and scheme from bundle URL', () => {
  assert.deepEqual(
    resolveRuntimeTransportHints({
      platform: 'android',
      bundleUrl: 'https://10.0.0.10:8082/index.bundle?platform=android',
    }),
    {
      host: '10.0.0.10',
      port: 8082,
      scheme: 'https',
    },
  );
});

test('applyRuntimeHintsToApp writes React Native Android dev prefs', async () => {
  await withMockedAdb(async ({ device, argsLogPath, readFilePath, scriptFilePath }) => {
    await fs.writeFile(
      readFilePath,
      [
        '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>',
        '<map>',
        '  <string name="keep">value</string>',
        '</map>',
        '',
      ].join('\n'),
      'utf8',
    );

    await applyRuntimeHintsToApp({
      device,
      appId: 'com.example.demo',
      runtime: {
        platform: 'android',
        bundleUrl: 'https://10.0.0.10:8082/index.bundle?platform=android',
      },
    });

    const loggedArgs = await fs.readFile(argsLogPath, 'utf8');
    const script = await fs.readFile(scriptFilePath, 'utf8');
    assert.match(loggedArgs, /shell run-as com\.example\.demo cat shared_prefs\/ReactNativeDevPrefs\.xml/);
    assert.match(loggedArgs, /shell run-as com\.example\.demo sh -c/);
    assert.match(script, /<string name="keep">value<\/string>/);
    assert.match(script, /<string name="debug_http_host">10\.0\.0\.10:8082<\/string>/);
    assert.match(script, /<boolean name="dev_server_https" value="true" \/>/);
  });
});

test('clearRuntimeHintsFromApp removes managed Android runtime prefs but preserves unrelated entries', async () => {
  await withMockedAdb(async ({ device, readFilePath, scriptFilePath }) => {
    await fs.writeFile(
      readFilePath,
      [
        '<?xml version="1.0" encoding="utf-8" standalone="yes" ?>',
        '<map>',
        '  <string name="keep">value</string>',
        '  <string name="debug_http_host">10.0.0.10:8081</string>',
        '  <boolean name="dev_server_https" value="true" />',
        '</map>',
        '',
      ].join('\n'),
      'utf8',
    );

    await clearRuntimeHintsFromApp({
      device,
      appId: 'com.example.demo',
    });

    const script = await fs.readFile(scriptFilePath, 'utf8');
    assert.match(script, /<string name="keep">value<\/string>/);
    assert.doesNotMatch(script, /debug_http_host/);
    assert.doesNotMatch(script, /dev_server_https/);
  });
});

test('applyRuntimeHintsToApp writes iOS simulator React Native defaults', async () => {
  await withMockedXcrun(async ({ device, argsLogPath }) => {
    await applyRuntimeHintsToApp({
      device,
      appId: 'com.example.demo',
      runtime: {
        platform: 'ios',
        metroHost: '127.0.0.1',
        metroPort: 8081,
      },
    });

    const loggedArgs = await fs.readFile(argsLogPath, 'utf8');
    assert.match(loggedArgs, /simctl spawn sim-1 defaults write com\.example\.demo RCT_jsLocation -string 127\.0\.0\.1:8081/);
    assert.match(loggedArgs, /simctl spawn sim-1 defaults write com\.example\.demo RCT_packager_scheme -string http/);
  });
});

test('clearRuntimeHintsFromApp deletes iOS simulator React Native defaults', async () => {
  await withMockedXcrun(async ({ device, argsLogPath }) => {
    await clearRuntimeHintsFromApp({
      device,
      appId: 'com.example.demo',
    });

    const loggedArgs = await fs.readFile(argsLogPath, 'utf8');
    assert.match(loggedArgs, /simctl spawn sim-1 defaults delete com\.example\.demo RCT_jsLocation/);
    assert.match(loggedArgs, /simctl spawn sim-1 defaults delete com\.example\.demo RCT_packager_scheme/);
  });
});
