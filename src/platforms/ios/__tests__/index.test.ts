import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listIosApps, openIosApp, parseIosDeviceAppsPayload, reinstallIosApp, resolveIosApp } from '../index.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';

test('openIosApp custom scheme deep links on iOS devices require app bundle context', async () => {
  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  await assert.rejects(
    () => openIosApp(device, 'myapp://home'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      return true;
    },
  );
});

test('openIosApp web URL on iOS device without app falls back to Safari', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-safari-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    await openIosApp(device, 'https://example.com/path');
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      'ios-device-1',
      'com.apple.mobilesafari',
      '--payload-url',
      'https://example.com/path',
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

test('openIosApp custom scheme on iOS device uses active app context', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-openurl-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    await openIosApp(device, 'myapp://item/42', { appBundleId: 'com.example.app' });
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      'ios-device-1',
      'com.example.app',
      '--payload-url',
      'myapp://item/42',
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

test('reinstallIosApp on iOS physical device uses devicectl uninstall + install', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-reinstall-device-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "info" ] && [ "$4" = "apps" ]; then',
      '  out=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--json-output" ]; then',
      '      out="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      "  cat > \"$out\" <<'JSON'",
      '{"result":{"apps":[{"bundleIdentifier":"com.example.demo","name":"Demo"}]}}',
      'JSON',
      'fi',
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
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    const appPath = path.join(tmpDir, 'Sample.app');
    await fs.writeFile(appPath, 'placeholder', 'utf8');
    const result = await reinstallIosApp(device, 'Demo', appPath);
    assert.equal(result.bundleId, 'com.example.demo');

    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);

    const uninstallIdx = args.indexOf('uninstall');
    const installIdx = args.indexOf('install');
    assert.notEqual(uninstallIdx, -1);
    assert.notEqual(installIdx, -1);
    assert.equal(uninstallIdx < installIdx, true, 'reinstall should uninstall before install');
    assert.deepEqual(args.slice(uninstallIdx - 2, uninstallIdx + 5), [
      'devicectl',
      'device',
      'uninstall',
      'app',
      '--device',
      'ios-device-1',
      'com.example.demo',
    ]);
    assert.deepEqual(args.slice(installIdx - 2, installIdx + 5), [
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      'ios-device-1',
      appPath,
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

test('reinstallIosApp on iOS physical device proceeds when uninstall reports app not installed', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-reinstall-device-missing-app-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'printf "%s\\n" "$@" >> "$AGENT_DEVICE_TEST_ARGS_FILE"',
      'if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "info" ] && [ "$4" = "apps" ]; then',
      '  out=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--json-output" ]; then',
      '      out="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      "  cat > \"$out\" <<'JSON'",
      '{"result":{"apps":[{"bundleIdentifier":"com.example.demo","name":"Demo"}]}}',
      'JSON',
      '  exit 0',
      'fi',
      'if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "uninstall" ] && [ "$4" = "app" ]; then',
      '  echo "app not installed" >&2',
      '  exit 1',
      'fi',
      'if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "install" ] && [ "$4" = "app" ]; then',
      '  exit 0',
      'fi',
      'echo "unexpected xcrun args: $@" >&2',
      'exit 1',
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
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    const appPath = path.join(tmpDir, 'Sample.app');
    await fs.writeFile(appPath, 'placeholder', 'utf8');
    const result = await reinstallIosApp(device, 'Demo', appPath);
    assert.equal(result.bundleId, 'com.example.demo');

    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.equal(args.includes('uninstall'), true);
    assert.equal(args.includes('install'), true);
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

test('openIosApp with app and URL on iOS device launches app bundle with payload URL', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-open-app-url-test-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  const argsLogPath = path.join(tmpDir, 'args.log');
  await fs.writeFile(
    xcrunPath,
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$AGENT_DEVICE_TEST_ARGS_FILE"\nexit 0\n',
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  const previousArgsFile = process.env.AGENT_DEVICE_TEST_ARGS_FILE;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;
  process.env.AGENT_DEVICE_TEST_ARGS_FILE = argsLogPath;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    await openIosApp(device, 'MyApp', { appBundleId: 'com.example.app', url: 'myapp://screen/to' });
    const args = (await fs.readFile(argsLogPath, 'utf8'))
      .trim()
      .split('\n')
      .filter(Boolean);
    assert.deepEqual(args, [
      'devicectl',
      'device',
      'process',
      'launch',
      '--device',
      'ios-device-1',
      'com.example.app',
      '--payload-url',
      'myapp://screen/to',
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

test('parseIosDeviceAppsPayload maps devicectl app entries', () => {
  const apps = parseIosDeviceAppsPayload({
    result: {
      apps: [
        {
          bundleIdentifier: 'com.apple.Maps',
          name: 'Maps',
        },
        {
          bundleIdentifier: 'com.example.NoName',
        },
      ],
    },
  });

  assert.equal(apps.length, 2);
  assert.deepEqual(apps[0], {
    bundleId: 'com.apple.Maps',
    name: 'Maps',
  });
  assert.equal(apps[1].bundleId, 'com.example.NoName');
  assert.equal(apps[1].name, 'com.example.NoName');
});

test('parseIosDeviceAppsPayload ignores malformed entries', () => {
  const apps = parseIosDeviceAppsPayload({
    result: {
      apps: [
        null,
        {},
        { name: 'Missing bundle id' },
        { bundleIdentifier: '' },
      ],
    },
  });
  assert.deepEqual(apps, []);
});

test('resolveIosApp resolves app display name on iOS physical devices', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-app-resolve-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "devicectl" ] && [ "$2" = "device" ] && [ "$3" = "info" ] && [ "$4" = "apps" ]; then',
      '  out=""',
      '  while [ "$#" -gt 0 ]; do',
      '    if [ "$1" = "--json-output" ]; then',
      '      out="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      "  cat > \"$out\" <<'JSON'",
      '{"result":{"apps":[{"bundleIdentifier":"com.apple.Maps","name":"Maps"},{"bundleIdentifier":"com.example.demo","name":"Demo"}]}}',
      'JSON',
      '  exit 0',
      'fi',
      'echo "unexpected xcrun args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  try {
    const bundleId = await resolveIosApp(device, 'Maps');
    assert.equal(bundleId, 'com.apple.Maps');
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('listIosApps applies user-installed filter on simulator', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-list-sim-'));
  const xcrunPath = path.join(tmpDir, 'xcrun');
  await fs.writeFile(
    xcrunPath,
    [
      '#!/bin/sh',
      'if [ "$1" = "simctl" ] && [ "$2" = "listapps" ]; then',
      "  cat <<'JSON'",
      '{"com.apple.Maps":{"CFBundleDisplayName":"Maps"},"com.example.demo":{"CFBundleDisplayName":"Demo"}}',
      'JSON',
      '  exit 0',
      'fi',
      'echo "unexpected xcrun args: $@" >&2',
      'exit 1',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.chmod(xcrunPath, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpDir}${path.delimiter}${previousPath ?? ''}`;

  const device: DeviceInfo = {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone Sim',
    kind: 'simulator',
    booted: true,
  };

  try {
    const apps = await listIosApps(device, 'user-installed');
    assert.deepEqual(apps, [{ bundleId: 'com.example.demo', name: 'Demo' }]);
  } finally {
    process.env.PATH = previousPath;
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
