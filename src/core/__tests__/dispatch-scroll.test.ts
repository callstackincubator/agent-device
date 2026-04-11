import { test } from 'vitest';
import assert from 'node:assert/strict';
import { dispatchCommand } from '../dispatch.ts';
import { AppError } from '../../utils/errors.ts';
import { IOS_SIMULATOR } from '../../__tests__/test-utils/device-fixtures.ts';

test('dispatch scroll rejects mixing amount and --pixels', async () => {
  await assert.rejects(
    () => dispatchCommand(IOS_SIMULATOR, 'scroll', ['down', '0.4'], undefined, { pixels: 240 }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /either a relative amount or --pixels/i.test(error.message),
  );
});
