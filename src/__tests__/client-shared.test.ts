import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  serializeInstallFromSourceResult,
  serializeOpenResult,
  serializeSnapshotResult,
  serializeSessionListEntry,
} from '../client-shared.ts';

test('serializeSessionListEntry preserves legacy android session payload shape', () => {
  const data = serializeSessionListEntry({
    name: 'qa',
    createdAt: 123,
    device: {
      platform: 'android',
      target: 'mobile',
      id: 'emulator-5554',
      name: 'Pixel 9',
      identifiers: {
        session: 'qa',
        deviceId: 'emulator-5554',
        deviceName: 'Pixel 9',
        serial: 'emulator-5554',
      },
      android: {
        serial: 'emulator-5554',
      },
    },
    identifiers: {
      session: 'qa',
      deviceId: 'emulator-5554',
      deviceName: 'Pixel 9',
      serial: 'emulator-5554',
    },
  });

  assert.deepEqual(data, {
    name: 'qa',
    platform: 'android',
    target: 'mobile',
    device: 'Pixel 9',
    id: 'emulator-5554',
    createdAt: 123,
  });
});

test('serializeOpenResult includes android serial for open payloads', () => {
  const data = serializeOpenResult({
    session: 'qa',
    device: {
      platform: 'android',
      target: 'mobile',
      id: 'emulator-5554',
      name: 'Pixel 9',
      identifiers: {
        session: 'qa',
        deviceId: 'emulator-5554',
        deviceName: 'Pixel 9',
        serial: 'emulator-5554',
      },
      android: {
        serial: 'emulator-5554',
      },
    },
    identifiers: {
      session: 'qa',
      deviceId: 'emulator-5554',
      deviceName: 'Pixel 9',
      serial: 'emulator-5554',
    },
  });

  assert.deepEqual(data, {
    session: 'qa',
    platform: 'android',
    target: 'mobile',
    device: 'Pixel 9',
    id: 'emulator-5554',
    serial: 'emulator-5554',
    message: 'Opened: qa',
  });
});

test('serializeInstallFromSourceResult uses install-family package naming', () => {
  const data = serializeInstallFromSourceResult({
    launchTarget: 'com.example.demo',
    appName: 'Demo',
    appId: 'com.example.demo',
    packageName: 'com.example.demo',
    identifiers: {
      appId: 'com.example.demo',
      package: 'com.example.demo',
    },
  });

  assert.deepEqual(data, {
    launchTarget: 'com.example.demo',
    appName: 'Demo',
    appId: 'com.example.demo',
    package: 'com.example.demo',
    message: 'Installed: Demo',
  });
});

test('serializeSnapshotResult includes Android backend metadata', () => {
  const data = serializeSnapshotResult({
    nodes: [],
    truncated: false,
    androidSnapshot: {
      backend: 'android-helper',
      helperVersion: '0.13.3',
      installReason: 'current',
      waitForIdleTimeoutMs: 500,
      nodeCount: 12,
    },
    identifiers: {
      session: 'qa',
    },
  });

  assert.deepEqual(data, {
    nodes: [],
    truncated: false,
    androidSnapshot: {
      backend: 'android-helper',
      helperVersion: '0.13.3',
      installReason: 'current',
      waitForIdleTimeoutMs: 500,
      nodeCount: 12,
    },
  });
});
