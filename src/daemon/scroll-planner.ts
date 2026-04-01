import type { Rect } from '../utils/snapshot.ts';
import {
  distanceFromSafeViewportBand,
  isRectVisibleInViewport,
  isRectWithinSafeViewportBand,
  resolveViewportRect,
} from '../utils/rect-visibility.ts';

type ScrollIntoViewPlan = {
  x: number;
  startY: number;
  endY: number;
  direction: 'up' | 'down';
};

export { resolveViewportRect, isRectVisibleInViewport, isRectWithinSafeViewportBand };
export { distanceFromSafeViewportBand };

export function buildScrollIntoViewPlan(
  targetRect: Rect,
  viewportRect: Rect,
): ScrollIntoViewPlan | null {
  const viewportHeight = Math.max(1, viewportRect.height);
  const viewportWidth = Math.max(1, viewportRect.width);
  const viewportTop = viewportRect.y;
  const viewportBottom = viewportRect.y + viewportHeight;
  const viewportLeft = viewportRect.x;
  const viewportRight = viewportRect.x + viewportWidth;
  // The "safe band" is the middle 50% of the viewport — elements inside this band
  // are considered comfortably visible.  The 25% margins on each side account for
  // toolbars, nav bars, and partially clipped content that may overlap the edges.
  const safeTop = viewportTop + viewportHeight * 0.25;
  const safeBottom = viewportBottom - viewportHeight * 0.25;
  // Keep the swipe lane at least 8 px or 10% of viewport width from the edge to
  // avoid triggering system edge gestures (iOS swipe-back, Android nav drawer).
  const lanePaddingPx = Math.max(8, viewportWidth * 0.1);
  const targetCenterY = targetRect.y + targetRect.height / 2;
  const targetCenterX = targetRect.x + targetRect.width / 2;

  if (targetCenterY >= safeTop && targetCenterY <= safeBottom) {
    return null;
  }

  const x = Math.round(
    clamp(targetCenterX, viewportLeft + lanePaddingPx, viewportRight - lanePaddingPx),
  );
  // Drag from 86% to 14% of viewport height (~72% travel) to produce a reliable
  // scroll gesture.  Starting/ending too close to the edges risks triggering
  // notification shade or home-indicator areas on modern devices.
  const dragUpStartY = Math.round(viewportTop + viewportHeight * 0.86);
  const dragUpEndY = Math.round(viewportTop + viewportHeight * 0.14);
  const dragDownStartY = dragUpEndY;
  const dragDownEndY = dragUpStartY;

  if (targetCenterY > safeBottom) {
    return {
      x,
      startY: dragUpStartY,
      endY: dragUpEndY,
      direction: 'down',
    };
  }

  return {
    x,
    startY: dragDownStartY,
    endY: dragDownEndY,
    direction: 'up',
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
