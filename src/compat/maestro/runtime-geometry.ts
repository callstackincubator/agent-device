import type { Rect, SnapshotNode } from '../../utils/snapshot.ts';
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
        end: { x: center.x, y: clampCoordinate(center.y - verticalDistance, minY, maxY) },
      };
    case 'down':
      return {
        ok: true,
        start: center,
        end: { x: center.x, y: clampCoordinate(center.y + verticalDistance, minY, maxY) },
      };
    case 'left':
      return {
        ok: true,
        start: center,
        end: { x: clampCoordinate(center.x - horizontalDistance, minX, maxX), y: center.y },
      };
    case 'right':
      return {
        ok: true,
        start: center,
        end: { x: clampCoordinate(center.x + horizontalDistance, minX, maxX), y: center.y },
      };
    default:
      return { ok: false, message: 'swipe.label direction must be up, down, left, or right.' };
  }
}

export function pointForMaestroTapOnTarget(
  target: MaestroSnapshotTarget,
  isVisibleTextSelector: boolean,
): { x: number; y: number } {
  if (!shouldBiasMaestroVisibleTextTap(target.node, isVisibleTextSelector, target.rect)) {
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

function clampCoordinate(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function pointInsideRect(rect: Rect): { x: number; y: number } {
  return {
    x: interiorCoordinate(rect.x, rect.width),
    y: interiorCoordinate(rect.y, rect.height),
  };
}

function shouldBiasMaestroVisibleTextTap(
  node: SnapshotNode,
  isVisibleTextSelector: boolean,
  rect: Rect,
): boolean {
  if (!isVisibleTextSelector) return false;
  if (rect.width < MAESTRO_GEOMETRY_POLICY.largeTextContainerBias.minWidth) {
    return false;
  }
  const type = normalizeType(node.type ?? '');
  const scrollableTextContainer = type === 'scrollview' || type === 'scroll-area';
  if (rect.height < MAESTRO_GEOMETRY_POLICY.largeTextContainerBias.minHeight) return false;
  return type === 'cell' || type === 'other' || scrollableTextContainer;
}

function interiorCoordinate(origin: number, size: number): number {
  // Maestro flows often expose hidden E2E controls as 1x1 views at the screen
  // edge. Preserve zero-origin taps for those controls instead of nudging them
  // outside their tiny rect by applying normal center/bounds clamping.
  if (size <= 1) return Math.floor(origin);
  const min = Math.ceil(origin);
  const max = Math.floor(origin + size - 1);
  return clampCoordinate(origin + size / 2, min, max);
}
