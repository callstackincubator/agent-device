import type { Rect } from '../utils/snapshot.ts';

export function hasPositiveRect(rect: Rect | undefined): rect is Rect {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

export function rectArea(rect: Rect): number {
  return rect.width * rect.height;
}

export function rectContains(container: Rect, nested: Rect): boolean {
  return (
    nested.x >= container.x &&
    nested.y >= container.y &&
    nested.x + nested.width <= container.x + container.width &&
    nested.y + nested.height <= container.y + container.height
  );
}

export function unionRects(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxRight = Number.NEGATIVE_INFINITY;
  let maxBottom = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxRight = Math.max(maxRight, rect.x + rect.width);
    maxBottom = Math.max(maxBottom, rect.y + rect.height);
  }
  return {
    x: minX,
    y: minY,
    width: maxRight - minX,
    height: maxBottom - minY,
  };
}
