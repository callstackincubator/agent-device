import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

const MACOS_DEVICE: DeviceInfo = {
  platform: 'macos',
  id: 'host-macos-local',
  name: 'Host Mac',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

test('dispatch pinch rejects helper-backed macOS surfaces', async () => {
  await assert.rejects(
    () => dispatchCommand(MACOS_DEVICE, 'pinch', ['1.5'], undefined, { surface: 'desktop' }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'UNSUPPORTED_OPERATION' &&
      /macOS app sessions/i.test(error.message),
  );
});
