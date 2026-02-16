import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listIosApps, openIosApp, parseIosDeviceAppsPayload, resolveIosApp } from '../index.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';

test('openIosApp rejects deep links on iOS physical devices', async () => {
  const device: DeviceInfo = {
    platform: 'ios',
    id: 'ios-device-1',
    name: 'iPhone Device',
    kind: 'device',
    booted: true,
  };

  await assert.rejects(
    () => openIosApp(device, 'https://example.com/path'),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
      return true;
    },
  );
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
