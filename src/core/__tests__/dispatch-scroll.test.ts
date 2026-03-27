import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const IOS_DEVICE: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone 17 Pro',
  kind: 'simulator',
  booted: true,
};

test('dispatch scroll rejects mixing amount and --pixels', async () => {
  await assert.rejects(
    () => dispatchCommand(IOS_DEVICE, 'scroll', ['down', '0.4'], undefined, { pixels: 240 }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /either a relative amount or --pixels/i.test(error.message),
  );
});
