import { expect, test } from 'vitest';
import { pointForMaestroTapOnTarget } from '../runtime-geometry.ts';

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
