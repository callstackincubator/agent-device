import { expect, test } from 'vitest';
import { pointForMaestroTapOnTarget, swipeCoordinatesFromTarget } from '../runtime-geometry.ts';

test('pointForMaestroTapOnTarget biases large scroll-area text containers toward the visible label', () => {
  const point = pointForMaestroTapOnTarget(
    {
      node: {
        index: 5,
        ref: 'e5',
        type: 'scroll-area',
        label: 'Article',
        rect: { x: 0, y: 117, width: 402, height: 180 },
      },
      rect: { x: 0, y: 117, width: 402, height: 180 },
      frame: { referenceWidth: 402, referenceHeight: 874 },
    },
    true,
  );

  expect(point).toEqual({ x: 84, y: 141 });
});

test('pointForMaestroTapOnTarget centers tall Android bottom-tab containers', () => {
  const point = pointForMaestroTapOnTarget(
    {
      node: {
        index: 40,
        ref: 'e41',
        type: 'android.widget.FrameLayout',
        label: 'Albums',
        rect: { x: 540, y: 2054, width: 270, height: 220 },
      },
      rect: { x: 540, y: 2054, width: 270, height: 220 },
      frame: { referenceWidth: 1080, referenceHeight: 2340 },
    },
    true,
  );

  expect(point).toEqual({ x: 675, y: 2164 });
});

test('swipeCoordinatesFromTarget preserves Maestro target-relative swipe distance', () => {
  const swipe = swipeCoordinatesFromTarget(
    {
      node: {
        index: 12,
        ref: 'e12',
        type: 'Cell',
        label: 'Card',
        rect: { x: 100, y: 200, width: 100, height: 80 },
      },
      rect: { x: 100, y: 200, width: 100, height: 80 },
      frame: { referenceWidth: 402, referenceHeight: 874 },
    },
    'right',
  );

  expect(swipe).toEqual({
    ok: true,
    start: { x: 150, y: 240 },
    end: { x: 300, y: 240 },
  });
});

test('swipeCoordinatesFromTarget clamps swipe endpoints to the viewport margin', () => {
  const swipe = swipeCoordinatesFromTarget(
    {
      node: {
        index: 12,
        ref: 'e12',
        type: 'Cell',
        label: 'Card',
        rect: { x: 340, y: 200, width: 100, height: 80 },
      },
      rect: { x: 340, y: 200, width: 100, height: 80 },
      frame: { referenceWidth: 402, referenceHeight: 874 },
    },
    'right',
  );

  expect(swipe).toEqual({
    ok: true,
    start: { x: 390, y: 240 },
    end: { x: 394, y: 240 },
  });
});
