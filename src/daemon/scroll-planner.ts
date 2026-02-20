import { centerOfRect, type RawSnapshotNode, type Rect } from '../utils/snapshot.ts';

type ScrollIntoViewPlan = {
  x: number;
  startY: number;
  endY: number;
  count: number;
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

export function buildScrollIntoViewPlan(targetRect: Rect, viewportRect: Rect): ScrollIntoViewPlan | null {
  const viewportHeight = Math.max(1, viewportRect.height);
  const viewportTop = viewportRect.y;
  const viewportBottom = viewportRect.y + viewportHeight;
  const safeTop = viewportTop + viewportHeight * 0.25;
  const safeBottom = viewportBottom - viewportHeight * 0.25;
  const targetCenterY = targetRect.y + targetRect.height / 2;

  if (targetCenterY >= safeTop && targetCenterY <= safeBottom) {
    return null;
  }

  const x = Math.round(viewportRect.x + viewportRect.width / 2);
  const dragUpStartY = Math.round(viewportTop + viewportHeight * 0.78);
  const dragUpEndY = Math.round(viewportTop + viewportHeight * 0.22);
  const dragDownStartY = dragUpEndY;
  const dragDownEndY = dragUpStartY;
  const swipeStepPx = Math.max(1, Math.abs(dragUpStartY - dragUpEndY) * 0.9);

  if (targetCenterY > safeBottom) {
    const delta = targetCenterY - safeBottom;
    return {
      x,
      startY: dragUpStartY,
      endY: dragUpEndY,
      count: clampInt(Math.ceil(delta / swipeStepPx), 1, 50),
      direction: 'down',
    };
  }

  const delta = safeTop - targetCenterY;
  return {
    x,
    startY: dragDownStartY,
    endY: dragDownEndY,
    count: clampInt(Math.ceil(delta / swipeStepPx), 1, 50),
    direction: 'up',
  };
}

export function isRectWithinSafeViewportBand(targetRect: Rect, viewportRect: Rect): boolean {
  const viewportHeight = Math.max(1, viewportRect.height);
  const viewportTop = viewportRect.y;
  const viewportBottom = viewportRect.y + viewportHeight;
  const safeTop = viewportTop + viewportHeight * 0.25;
  const safeBottom = viewportBottom - viewportHeight * 0.25;
  const targetCenterY = targetRect.y + targetRect.height / 2;
  return targetCenterY >= safeTop && targetCenterY <= safeBottom;
}

function hasValidRect(rect: Rect | undefined): rect is Rect {
  if (!rect) return false;
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height);
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

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}
