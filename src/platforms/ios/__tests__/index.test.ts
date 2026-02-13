import test from 'node:test';
import assert from 'node:assert/strict';
import { openIosApp } from '../index.ts';
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
