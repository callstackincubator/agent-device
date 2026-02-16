import test from 'node:test';
import assert from 'node:assert/strict';
import { withKeyedLock } from '../keyed-lock.ts';

test('withKeyedLock serializes work per key', async () => {
  const locks = new Map<string, Promise<unknown>>();
  const order: string[] = [];
  let active = 0;
  let maxActive = 0;

  await Promise.all([
    withKeyedLock(locks, 'device-a', async () => {
      order.push('start-1');
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      order.push('end-1');
    }),
    withKeyedLock(locks, 'device-a', async () => {
      order.push('start-2');
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      order.push('end-2');
    }),
  ]);

  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('withKeyedLock allows concurrent work across different keys', async () => {
  const locks = new Map<string, Promise<unknown>>();
  let active = 0;
  let maxActive = 0;

  await Promise.all([
    withKeyedLock(locks, 'device-a', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    }),
    withKeyedLock(locks, 'device-b', async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
    }),
  ]);

  assert.equal(maxActive, 2);
});
