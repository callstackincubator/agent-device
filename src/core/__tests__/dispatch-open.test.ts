import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

test('dispatch open rejects URL as first argument when second URL is provided', async () => {
  const device: DeviceInfo = {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone 15',
    kind: 'simulator',
    booted: true,
  };

  await assert.rejects(
    () => dispatchCommand(device, 'open', ['myapp://first', 'myapp://second']),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'INVALID_ARGS');
      assert.match((error as AppError).message, /requires an app target as the first argument/i);
      return true;
    },
  );
});

test('dispatch open rejects Android launch arguments instead of dropping them', async () => {
  const device: DeviceInfo = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  };

  await assert.rejects(
    () =>
      dispatchCommand(device, 'open', ['com.example.app'], undefined, {
        launchArgs: ['--fixture', 'demo'],
      }),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      assert.equal((error as AppError).code, 'UNSUPPORTED_OPERATION');
      assert.match((error as AppError).message, /Apple platforms/i);
      return true;
    },
  );
});
