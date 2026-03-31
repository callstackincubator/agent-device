import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const ANDROID_DEVICE: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

test('dispatch type rejects ref-shaped first positional with a repair hint', async () => {
  await assert.rejects(
    () => dispatchCommand(ANDROID_DEVICE, 'type', ['@ref42', 'filed', 'the', 'expense']),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /does not accept a target ref/i.test(error.message) &&
      /Use fill @ref42 "text".*press @ref42 then type "text"/i.test(error.details?.hint ?? ''),
  );
});
