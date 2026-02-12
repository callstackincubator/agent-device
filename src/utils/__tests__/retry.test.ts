import test from 'node:test';
import assert from 'node:assert/strict';
import { Deadline, retryWithPolicy } from '../retry.ts';

test('Deadline tracks remaining and expiration', async () => {
  const deadline = Deadline.fromTimeoutMs(25);
  assert.equal(deadline.isExpired(), false);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(deadline.isExpired(), true);
  assert.equal(deadline.remainingMs(), 0);
});

test('retryWithPolicy retries until success', async () => {
  let attempts = 0;
  const result = await retryWithPolicy(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw new Error('transient');
      }
      return 'ok';
    },
    { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1, jitter: 0 },
  );
  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
});
