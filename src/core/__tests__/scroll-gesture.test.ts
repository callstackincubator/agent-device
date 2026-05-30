import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AppError } from '../../utils/errors.ts';
import {
  buildScrollGesturePlan,
  buildSwipeGesturePlan,
  clampGestureCoordinate,
  pointFromPercent,
} from '../scroll-gesture.ts';

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

test('buildSwipeGesturePlan maps finger direction through the shared scroll planner', () => {
  const plan = buildSwipeGesturePlan({
    direction: 'left',
    amount: 0.6,
    referenceWidth: 400,
    referenceHeight: 800,
  });

  assert.deepEqual(plan, {
    direction: 'left',
    x1: 320,
    y1: 400,
    x2: 80,
    y2: 400,
    referenceWidth: 400,
    referenceHeight: 800,
    amount: 0.6,
    pixels: 240,
  });
});

test('pointFromPercent preserves unclamped percentages and clamps when a margin is requested', () => {
  const frame = { referenceWidth: 400, referenceHeight: 800 };

  assert.deepEqual(pointFromPercent(frame, 125, -10), { x: 500, y: -80 });
  assert.deepEqual(pointFromPercent(frame, 100, 0, { marginPx: 8 }), { x: 392, y: 8 });
});

test('clampGestureCoordinate rounds values and clamps them into the safe gesture band', () => {
  assert.equal(clampGestureCoordinate(10.4, 8, 100), 10);
  assert.equal(clampGestureCoordinate(10.6, 8, 100), 11);
  assert.equal(clampGestureCoordinate(2.6, 8, 100), 8);
  assert.equal(clampGestureCoordinate(97.6, 8, 100), 92);
});
