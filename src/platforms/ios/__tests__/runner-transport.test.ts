import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';
import { waitForRunner } from '../runner-transport.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

test('waitForRunner propagates request cancellation without fallback', async () => {
  const signal = AbortSignal.abort();
  await assert.rejects(
    () =>
      waitForRunner(
        iosSimulator,
        8100,
        { command: 'snapshot' },
        undefined,
        5_000,
        undefined,
        signal,
      ),
    (error: unknown) => {
      assert.equal(error instanceof AppError, true);
      const appError = error as AppError;
      assert.equal(appError.code, 'COMMAND_FAILED');
      assert.equal(appError.message, 'request canceled');
      assert.equal(appError.message.includes('Runner did not accept connection'), false);
      return true;
    },
  );
});
