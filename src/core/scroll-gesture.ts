import { AppError } from '../utils/errors.ts';

export type ScrollDirection = 'up' | 'down' | 'left' | 'right';

export type GestureReferenceFrame = {
  referenceWidth: number;
  referenceHeight: number;
};

export type GesturePoint = {
  x: number;
  y: number;
};

export type ScrollGestureOptions = {
  direction: ScrollDirection;
  amount?: number;
  pixels?: number;
  referenceWidth: number;
  referenceHeight: number;
};

export type ScrollGesturePlan = {
  direction: ScrollDirection;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  referenceWidth: number;
  referenceHeight: number;
  amount?: number;
  pixels: number;
};

export type SwipeGestureOptions = ScrollGestureOptions;

export type SwipeGesturePlan = Omit<ScrollGesturePlan, 'direction'> & {
  direction: ScrollDirection;
};

const DEFAULT_SCROLL_AMOUNT = 0.6;
const DEFAULT_EDGE_PADDING_FRACTION = 0.05;

export function buildScrollGesturePlan(options: ScrollGestureOptions): ScrollGesturePlan {
  const direction = options.direction;
  const axisLength =
    direction === 'up' || direction === 'down' ? options.referenceHeight : options.referenceWidth;
  const requestedAmount = resolveRequestedAmount(options.amount);
  const requestedPixels =
    options.pixels !== undefined
      ? normalizeRequestedPixels(options.pixels)
      : Math.round(axisLength * requestedAmount);
  const edgePadding = Math.max(1, Math.round(axisLength * DEFAULT_EDGE_PADDING_FRACTION));
  const maxTravelPixels = Math.max(1, axisLength - edgePadding * 2);
  const travelPixels = Math.max(1, Math.min(requestedPixels, maxTravelPixels));
  const halfTravel = Math.round(travelPixels / 2);
  const centerX = Math.round(options.referenceWidth / 2);
  const centerY = Math.round(options.referenceHeight / 2);
  const buildPlan = (x1: number, y1: number, x2: number, y2: number): ScrollGesturePlan => ({
    direction,
    x1,
    y1,
    x2,
    y2,
    referenceWidth: options.referenceWidth,
    referenceHeight: options.referenceHeight,
    amount: options.amount,
    pixels: travelPixels,
  });

  switch (direction) {
    case 'up':
      return buildPlan(centerX, centerY - halfTravel, centerX, centerY + halfTravel);
    case 'down':
      return buildPlan(centerX, centerY + halfTravel, centerX, centerY - halfTravel);
    case 'left':
      return buildPlan(centerX - halfTravel, centerY, centerX + halfTravel, centerY);
    case 'right':
      return buildPlan(centerX + halfTravel, centerY, centerX - halfTravel, centerY);
  }
}

export function buildSwipeGesturePlan(options: SwipeGestureOptions): SwipeGesturePlan {
  const scrollPlan = buildScrollGesturePlan({
    ...options,
    direction: scrollDirectionForFingerSwipe(options.direction),
  });
  return {
    ...scrollPlan,
    direction: options.direction,
  };
}

export function pointFromPercent(
  frame: GestureReferenceFrame,
  xPercent: number,
  yPercent: number,
  options: { marginPx?: number } = {},
): GesturePoint {
  const point = {
    x: Math.round((frame.referenceWidth * xPercent) / 100),
    y: Math.round((frame.referenceHeight * yPercent) / 100),
  };
  if (options.marginPx === undefined) return point;
  return clampGesturePoint(point, frame, options.marginPx);
}

export function clampGesturePoint(
  point: GesturePoint,
  frame: GestureReferenceFrame,
  marginPx: number,
): GesturePoint {
  return {
    x: clampGestureCoordinate(point.x, marginPx, frame.referenceWidth),
    y: clampGestureCoordinate(point.y, marginPx, frame.referenceHeight),
  };
}

export function parseScrollDirection(direction: string): ScrollDirection {
  switch (direction) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      return direction;
    default:
      throw new AppError('INVALID_ARGS', `Unknown direction: ${direction}`);
  }
}

function scrollDirectionForFingerSwipe(direction: ScrollDirection): ScrollDirection {
  switch (direction) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

function resolveRequestedAmount(amount: number | undefined): number {
  if (amount === undefined) return DEFAULT_SCROLL_AMOUNT;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('INVALID_ARGS', 'scroll amount must be a positive number');
  }
  return amount;
}

function normalizeRequestedPixels(pixels: number): number {
  if (!Number.isFinite(pixels) || pixels <= 0) {
    throw new AppError('INVALID_ARGS', 'scroll pixels must be a positive integer');
  }
  return Math.max(1, Math.round(pixels));
}

export function clampGestureCoordinate(value: number, marginPx: number, size: number): number {
  const min = marginPx;
  const max = Math.max(min, size - marginPx);
  return clampToRange(value, min, max);
}

export function clampToRange(value: number, min: number, max: number): number {
  return Math.min(Math.round(max), Math.max(Math.round(min), Math.round(value)));
}
