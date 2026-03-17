import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeOpenResult, serializeSessionListEntry } from '../client-shared.ts';

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
  });
});
