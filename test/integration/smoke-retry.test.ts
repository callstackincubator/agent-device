import test from 'node:test';
import assert from 'node:assert/strict';
import { withRetry } from '../../src/utils/retry.ts';

test('withRetry retries and succeeds', async () => {
  let attempts = 0;
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('transient');
      }
      return 'ok';
    },
    { attempts: 3, baseDelayMs: 1, maxDelayMs: 2, jitter: 0 },
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});
