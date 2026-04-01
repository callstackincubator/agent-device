import { centerOfRect, type RawSnapshotNode, type Rect } from '../utils/snapshot.ts';

type ScrollIntoViewPlan = {
  x: number;
  startY: number;
  endY: number;
  direction: 'up' | 'down';
};

export function resolveViewportRect(nodes: RawSnapshotNode[], targetRect: Rect): Rect | null {
  const targetCenter = centerOfRect(targetRect);
  const rectNodes = nodes.filter((node) => hasValidRect(node.rect));
  const viewportNodes = rectNodes.filter((node) => {
    const type = (node.type ?? '').toLowerCase();
    return type.includes('application') || type.includes('window');
  });

  const containingViewport = pickLargestRect(
    viewportNodes
      .map((node) => node.rect as Rect)
      .filter((rect) => containsPoint(rect, targetCenter.x, targetCenter.y)),
  );
  if (containingViewport) return containingViewport;

  const viewportFallback = pickLargestRect(viewportNodes.map((node) => node.rect as Rect));
  if (viewportFallback) return viewportFallback;

  const genericContaining = pickLargestRect(
    rectNodes
      .map((node) => node.rect as Rect)
      .filter((rect) => containsPoint(rect, targetCenter.x, targetCenter.y)),
  );
  if (genericContaining) return genericContaining;

  return null;
}

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
  const safeTop = viewportTop + viewportHeight * 0.25;
  const safeBottom = viewportBottom - viewportHeight * 0.25;
  const lanePaddingPx = Math.max(8, viewportWidth * 0.1);
  const targetCenterY = targetRect.y + targetRect.height / 2;
  const targetCenterX = targetRect.x + targetRect.width / 2;

  if (targetCenterY >= safeTop && targetCenterY <= safeBottom) {
    return null;
  }

  const x = Math.round(
    clamp(targetCenterX, viewportLeft + lanePaddingPx, viewportRight - lanePaddingPx),
  );
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

export function isRectWithinSafeViewportBand(targetRect: Rect, viewportRect: Rect): boolean {
  return distanceFromSafeViewportBand(targetRect, viewportRect) === 0;
}

export function isRectVisibleInViewport(targetRect: Rect, viewportRect: Rect): boolean {
  return (
    rangesOverlapInclusive(
      targetRect.x,
      targetRect.x + targetRect.width,
      viewportRect.x,
      viewportRect.x + viewportRect.width,
    ) &&
    rangesOverlapInclusive(
      targetRect.y,
      targetRect.y + targetRect.height,
      viewportRect.y,
      viewportRect.y + viewportRect.height,
    )
  );
}

export function distanceFromSafeViewportBand(targetRect: Rect, viewportRect: Rect): number {
  const viewportHeight = Math.max(1, viewportRect.height);
  const viewportTop = viewportRect.y;
  const viewportBottom = viewportRect.y + viewportHeight;
  const safeTop = viewportTop + viewportHeight * 0.25;
  const safeBottom = viewportBottom - viewportHeight * 0.25;
  const targetCenterY = targetRect.y + targetRect.height / 2;
  if (targetCenterY < safeTop) return Math.ceil(safeTop - targetCenterY);
  if (targetCenterY > safeBottom) return Math.ceil(targetCenterY - safeBottom);
  return 0;
}

function hasValidRect(rect: Rect | undefined): rect is Rect {
  if (!rect) return false;
  return (
    Number.isFinite(rect.x) &&
    Number.isFinite(rect.y) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height)
  );
}

function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

function pickLargestRect(rects: Rect[]): Rect | null {
  let best: Rect | null = null;
  let bestArea = -1;
  for (const rect of rects) {
    const area = rect.width * rect.height;
    if (area > bestArea) {
      best = rect;
      bestArea = area;
    }
  }
  return best;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rangesOverlapInclusive(
  leftStart: number,
  leftEnd: number,
  rightStart: number,
  rightEnd: number,
): boolean {
  return Math.max(leftStart, rightStart) <= Math.min(leftEnd, rightEnd);
}
