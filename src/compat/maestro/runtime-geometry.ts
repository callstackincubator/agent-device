import { clampToRange } from '../../core/scroll-gesture.ts';
import type { Rect, SnapshotNode } from '../../utils/snapshot.ts';
import { interiorCoordinate, pointInsideRect } from '../../utils/rect-center.ts';
import { normalizeType } from '../../utils/snapshot-processing.ts';
import type { MaestroSnapshotTarget } from './runtime-targets.ts';

const MAESTRO_GEOMETRY_POLICY = {
  swipe: {
    screenRatio: 0.35,
    minDistancePx: 120,
    maxDistancePx: 360,
    marginPx: 8,
  },
  largeTextContainerBias: {
    minWidth: 120,
    minHeight: 70,
    maxHeight: 200,
    width: 168,
    height: 48,
  },
} as const;

export function swipeCoordinatesFromTarget(
  target: MaestroSnapshotTarget,
  direction: string,
):
  | { ok: true; start: { x: number; y: number }; end: { x: number; y: number } }
  | { ok: false; message: string } {
  const center = pointInsideRect(target.rect);
  const frame = target.frame;
  const horizontalDistance = swipeDistance(frame?.referenceWidth, target.rect.width);
  const verticalDistance = swipeDistance(frame?.referenceHeight, target.rect.height);
  const margin = MAESTRO_GEOMETRY_POLICY.swipe.marginPx;
  const minX = margin;
  const minY = margin;
  const maxX = frame ? frame.referenceWidth - margin : center.x + horizontalDistance;
  const maxY = frame ? frame.referenceHeight - margin : center.y + verticalDistance;
  switch (direction.toLowerCase()) {
    case 'up':
      return {
        ok: true,
        start: center,
        end: {
          x: center.x,
          y: clampToRange(center.y - verticalDistance, minY, maxY),
        },
      };
    case 'down':
      return {
        ok: true,
        start: center,
        end: {
          x: center.x,
          y: clampToRange(center.y + verticalDistance, minY, maxY),
        },
      };
    case 'left':
      return {
        ok: true,
        start: center,
        end: {
          x: clampToRange(center.x - horizontalDistance, minX, maxX),
          y: center.y,
        },
      };
    case 'right':
      return {
        ok: true,
        start: center,
        end: {
          x: clampToRange(center.x + horizontalDistance, minX, maxX),
          y: center.y,
        },
      };
    default:
      return { ok: false, message: 'swipe.label direction must be up, down, left, or right.' };
  }
}

export function pointForMaestroTapOnTarget(
  target: MaestroSnapshotTarget,
  isVisibleTextSelector: boolean,
  options: { allowLargeContainerBias?: boolean } = {},
): { x: number; y: number } {
  if (
    !shouldBiasMaestroVisibleTextTap(
      target.node,
      isVisibleTextSelector,
      target.rect,
      options.allowLargeContainerBias === true,
    )
  ) {
    return pointInsideRect(target.rect);
  }
  return {
    x: interiorCoordinate(
      target.rect.x,
      Math.min(target.rect.width, MAESTRO_GEOMETRY_POLICY.largeTextContainerBias.width),
    ),
    y: interiorCoordinate(
      target.rect.y,
      Math.min(target.rect.height, MAESTRO_GEOMETRY_POLICY.largeTextContainerBias.height),
    ),
  };
}

function swipeDistance(frameSize: number | undefined, rectSize: number): number {
  const screenRelative =
    typeof frameSize === 'number' ? frameSize * MAESTRO_GEOMETRY_POLICY.swipe.screenRatio : 0;
  return Math.round(
    Math.min(
      MAESTRO_GEOMETRY_POLICY.swipe.maxDistancePx,
      Math.max(MAESTRO_GEOMETRY_POLICY.swipe.minDistancePx, screenRelative, rectSize * 1.5),
    ),
  );
}

function shouldBiasMaestroVisibleTextTap(
  node: SnapshotNode,
  isVisibleTextSelector: boolean,
  rect: Rect,
  allowLargeContainerBias: boolean,
): boolean {
  if (!allowLargeContainerBias || !isVisibleTextSelector) return false;
  return isLargeTextContainerRect(rect) && isLargeTextContainerType(node);
}

function isLargeTextContainerRect(rect: Rect): boolean {
  const policy = MAESTRO_GEOMETRY_POLICY.largeTextContainerBias;
  return rect.width >= policy.minWidth && rect.height >= policy.minHeight && rect.height <= policy.maxHeight;
}

function isLargeTextContainerType(node: SnapshotNode): boolean {
  const type = normalizeType(node.type ?? '');
  return type === 'cell' || type === 'other' || isScrollableTextContainerType(type);
}

function isScrollableTextContainerType(type: string): boolean {
  return type === 'scrollview' || type === 'scroll-area';
}
