import { test } from 'vitest';
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

test('dispatch type rejects ref-looking first positional with a repair hint', async () => {
  await assert.rejects(
    () => dispatchCommand(IOS_DEVICE, 'type', ['@e52', 'filed the expense']),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /does not accept a target ref/i.test(error.message) &&
      /Use fill @e52 "text".*press @e52 then type "text"/i.test(error.details?.hint ?? ''),
  );
});
