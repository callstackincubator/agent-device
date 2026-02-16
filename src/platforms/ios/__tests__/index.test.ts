import test from 'node:test';
import assert from 'node:assert/strict';
import { openIosApp, parseIosDeviceAppsPayload } from '../index.ts';
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
