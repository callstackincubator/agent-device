import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AppError } from '../../utils/errors.ts';
import { buildScrollGesturePlan } from '../scroll-gesture.ts';

test('buildScrollGesturePlan maps relative amount to viewport travel', () => {
  const plan = buildScrollGesturePlan({
    direction: 'down',
    amount: 0.5,
    referenceWidth: 400,
    referenceHeight: 800,
  });

  assert.deepEqual(plan, {
    direction: 'down',
    x1: 200,
    y1: 600,
    x2: 200,
    y2: 200,
    referenceWidth: 400,
    referenceHeight: 800,
    amount: 0.5,
    pixels: 400,
  });
});

test('buildScrollGesturePlan clamps pixel travel to the safe gesture band', () => {
  const plan = buildScrollGesturePlan({
    direction: 'right',
    pixels: 500,
    referenceWidth: 300,
    referenceHeight: 600,
  });

  assert.equal(plan.x1, 285);
  assert.equal(plan.x2, 15);
  assert.equal(plan.y1, 300);
  assert.equal(plan.y2, 300);
  assert.equal(plan.pixels, 270);
});

test('buildScrollGesturePlan rejects invalid amounts', () => {
  assert.throws(
    () =>
      buildScrollGesturePlan({
        direction: 'down',
        amount: 0,
        referenceWidth: 400,
        referenceHeight: 800,
      }),
    (error: unknown) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      /amount must be a positive number/i.test(error.message),
  );
});
