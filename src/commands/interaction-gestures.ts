import { AppError } from '../utils/errors.ts';
import type { Point, Rect, SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { centerOfRect } from '../utils/snapshot.ts';
import type { AgentDeviceRuntime, CommandContext } from '../runtime.ts';
import { requireIntInRange } from '../utils/validation.ts';
import { successText } from '../utils/success-text.ts';
import { isNodeVisibleInEffectiveViewport } from '../utils/mobile-snapshot-semantics.ts';
import type { RuntimeCommand } from './index.ts';
import {
  assertSupportedInteractionSurface,
  captureInteractionSnapshot,
  type InteractionTarget,
  type ResolvedInteractionTarget,
  resolveInteractionTarget,
} from './interaction-resolution.ts';
import { toBackendContext } from './selector-read-utils.ts';

export type FocusCommandOptions = CommandContext & {
  target: InteractionTarget;
};

export type FocusCommandResult = ResolvedInteractionTarget & {
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type LongPressCommandOptions = CommandContext & {
  target: InteractionTarget;
  durationMs?: number;
};

export type LongPressCommandResult = ResolvedInteractionTarget & {
  durationMs?: number;
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type GestureDirection = 'up' | 'down' | 'left' | 'right';

export type ScrollTarget =
  | InteractionTarget
  | {
      kind: 'viewport';
    };

export type ScrollCommandOptions = CommandContext & {
  target?: ScrollTarget;
  direction: GestureDirection;
  amount?: number;
  pixels?: number;
};

export type ScrollCommandResult =
  | {
      kind: 'viewport';
      direction: GestureDirection;
      amount?: number;
      pixels?: number;
      backendResult?: Record<string, unknown>;
      message?: string;
    }
  | (ResolvedInteractionTarget & {
      direction: GestureDirection;
      amount?: number;
      pixels?: number;
      backendResult?: Record<string, unknown>;
      message?: string;
    });

type ResolvedScrollTarget = { kind: 'viewport' } | ResolvedInteractionTarget;

export type SwipeOptions = {
  from?: Point | InteractionTarget;
  to?: Point;
  direction?: GestureDirection;
  distance?: number;
  durationMs?: number;
};

export type SwipeCommandOptions = CommandContext & SwipeOptions;

export type SwipeCommandResult = {
  kind: 'swipe';
  from: Point;
  to: Point;
  direction?: GestureDirection;
  distance?: number;
  durationMs?: number;
  fromTarget?: ResolvedInteractionTarget | { kind: 'viewport' };
  backendResult?: Record<string, unknown>;
  message?: string;
};

export type PinchCommandOptions = CommandContext & {
  scale: number;
  center?: InteractionTarget;
};

export type PinchCommandResult = {
  kind: 'pinch';
  scale: number;
  center?: Point;
  centerTarget?: ResolvedInteractionTarget;
  backendResult?: Record<string, unknown>;
  message?: string;
};

export const focusCommand: RuntimeCommand<FocusCommandOptions, FocusCommandResult> = async (
  runtime,
  options,
): Promise<FocusCommandResult> => {
  const resolved = await resolveInteractionTarget(runtime, options, {
    action: 'focus',
    requireInteractive: true,
    promoteToHittableAncestor: false,
  });
  if (!runtime.backend.focus) {
    throw new AppError('UNSUPPORTED_OPERATION', 'focus is not supported by this backend');
  }
  const backendResult = await runtime.backend.focus(
    toBackendContext(runtime, options),
    resolved.point,
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    ...resolved,
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(`Focused (${resolved.point.x}, ${resolved.point.y})`),
  };
};

export const longPressCommand: RuntimeCommand<
  LongPressCommandOptions,
  LongPressCommandResult
> = async (runtime, options): Promise<LongPressCommandResult> => {
  const resolved = await resolveInteractionTarget(runtime, options, {
    action: 'longPress',
    requireInteractive: true,
    promoteToHittableAncestor: true,
  });
  if (!runtime.backend.longPress) {
    throw new AppError('UNSUPPORTED_OPERATION', 'longPress is not supported by this backend');
  }
  const durationMs =
    options.durationMs === undefined
      ? undefined
      : requireIntInRange(options.durationMs, 'durationMs', 0, 120_000);
  const backendResult = await runtime.backend.longPress(
    toBackendContext(runtime, options),
    resolved.point,
    { durationMs },
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    ...resolved,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(`Long pressed (${resolved.point.x}, ${resolved.point.y})`),
  };
};

export const scrollCommand: RuntimeCommand<ScrollCommandOptions, ScrollCommandResult> = async (
  runtime,
  options,
): Promise<ScrollCommandResult> => {
  if (!runtime.backend.scroll) {
    throw new AppError('UNSUPPORTED_OPERATION', 'scroll is not supported by this backend');
  }
  const direction = requireDirection(options.direction, 'scroll direction');
  const amount = normalizeOptionalPositiveNumber(options.amount, 'scroll amount');
  const pixels = normalizeOptionalPositiveInteger(options.pixels, 'scroll pixels');
  if (amount !== undefined && pixels !== undefined) {
    throw new AppError('INVALID_ARGS', 'scroll accepts either amount or pixels, not both');
  }

  const resolved = await resolveScrollTarget(runtime, options);
  const backendTarget =
    resolved.kind === 'viewport'
      ? { kind: 'viewport' as const }
      : { kind: 'point' as const, point: resolved.point };
  const backendResult = await runtime.backend.scroll(
    toBackendContext(runtime, options),
    backendTarget,
    {
      direction,
      ...(amount !== undefined ? { amount } : {}),
      ...(pixels !== undefined ? { pixels } : {}),
    },
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    ...resolved,
    direction,
    ...(amount !== undefined ? { amount } : {}),
    ...(pixels !== undefined ? { pixels } : {}),
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(
      pixels !== undefined
        ? `Scrolled ${direction} by ${pixels}px`
        : amount !== undefined
          ? `Scrolled ${direction} by ${amount}`
          : `Scrolled ${direction}`,
    ),
  };
};

export const swipeCommand: RuntimeCommand<SwipeCommandOptions, SwipeCommandResult> = async (
  runtime,
  options,
): Promise<SwipeCommandResult> => {
  if (!runtime.backend.swipe) {
    throw new AppError('UNSUPPORTED_OPERATION', 'swipe is not supported by this backend');
  }
  const resolvedFrom = await resolveSwipeFrom(runtime, options);
  const to = resolveSwipeTo(resolvedFrom.point, options);
  const durationMs =
    options.durationMs === undefined
      ? undefined
      : requireIntInRange(options.durationMs, 'durationMs', 16, 10_000);
  const backendResult = await runtime.backend.swipe(
    toBackendContext(runtime, options),
    resolvedFrom.point,
    to.point,
    { durationMs },
  );
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'swipe',
    from: resolvedFrom.point,
    to: to.point,
    ...(to.direction ? { direction: to.direction } : {}),
    ...(to.distance !== undefined ? { distance: to.distance } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(resolvedFrom.target ? { fromTarget: resolvedFrom.target } : {}),
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText('Swiped'),
  };
};

export const pinchCommand: RuntimeCommand<PinchCommandOptions, PinchCommandResult> = async (
  runtime,
  options,
): Promise<PinchCommandResult> => {
  if (!runtime.backend.pinch) {
    throw new AppError('UNSUPPORTED_OPERATION', 'pinch is not supported by this backend');
  }
  await assertSupportedInteractionSurface(runtime, options, 'pinch');
  const scale = normalizePositiveNumber(options.scale, 'pinch scale');
  const centerTarget = options.center
    ? await resolveInteractionTarget(
        runtime,
        { ...options, target: options.center },
        {
          action: 'pinch',
          requireInteractive: false,
          promoteToHittableAncestor: false,
        },
      )
    : undefined;
  const backendResult = await runtime.backend.pinch(toBackendContext(runtime, options), {
    scale,
    ...(centerTarget ? { center: centerTarget.point } : {}),
  });
  const formattedBackendResult = toBackendResult(backendResult);
  return {
    kind: 'pinch',
    scale,
    ...(centerTarget ? { center: centerTarget.point, centerTarget } : {}),
    ...(formattedBackendResult ? { backendResult: formattedBackendResult } : {}),
    ...successText(`Pinched to scale ${scale}`),
  };
};

async function resolveScrollTarget(
  runtime: AgentDeviceRuntime,
  options: ScrollCommandOptions,
): Promise<ResolvedScrollTarget> {
  const target = options.target ?? { kind: 'viewport' as const };
  if (target.kind === 'viewport') {
    await assertSupportedInteractionSurface(runtime, options, 'scroll');
    return { kind: 'viewport' };
  }
  return await resolveInteractionTarget(
    runtime,
    { ...options, target },
    {
      action: 'scroll',
      requireInteractive: false,
      promoteToHittableAncestor: false,
    },
  );
}

async function resolveSwipeFrom(
  runtime: AgentDeviceRuntime,
  options: SwipeCommandOptions,
): Promise<{
  point: Point;
  target?: ResolvedInteractionTarget | { kind: 'viewport' };
}> {
  if (options.from) {
    if (isPointLike(options.from)) {
      await assertSupportedInteractionSurface(runtime, options, 'swipe');
      return { point: requirePoint(options.from, 'from') };
    }
    const target = await resolveInteractionTarget(
      runtime,
      { ...options, target: options.from },
      {
        action: 'swipe',
        requireInteractive: false,
        promoteToHittableAncestor: false,
      },
    );
    return { point: target.point, target };
  }
  if (!options.direction) {
    throw new AppError('INVALID_ARGS', 'swipe requires from+to or a direction');
  }
  await assertSupportedInteractionSurface(runtime, options, 'swipe');
  const capture = await captureInteractionSnapshot(runtime, options, false);
  const viewport = resolveSnapshotViewport(capture.snapshot.nodes);
  return {
    point: centerOfRect(viewport),
    target: { kind: 'viewport' },
  };
}

function resolveSwipeTo(
  from: Point,
  options: SwipeCommandOptions,
): { point: Point; direction?: GestureDirection; distance?: number } {
  if (options.to) return { point: requirePoint(options.to, 'to') };
  const direction = requireDirection(options.direction, 'swipe direction');
  const distance = normalizePositiveNumber(options.distance ?? 200, 'swipe distance');
  switch (direction) {
    case 'up':
      return { point: { x: from.x, y: from.y - distance }, direction, distance };
    case 'down':
      return { point: { x: from.x, y: from.y + distance }, direction, distance };
    case 'left':
      return { point: { x: from.x - distance, y: from.y }, direction, distance };
    case 'right':
      return { point: { x: from.x + distance, y: from.y }, direction, distance };
  }
}

function requireDirection(
  direction: GestureDirection | undefined,
  field: string,
): GestureDirection {
  switch (direction) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      return direction;
    default:
      throw new AppError('INVALID_ARGS', `${field} must be up, down, left, or right`);
  }
}

function requirePoint(point: Point, field: string): Point {
  const x = Number(point.x);
  const y = Number(point.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AppError('INVALID_ARGS', `${field} point requires finite x and y`);
  }
  return { x, y };
}

function isPointLike(value: Point | InteractionTarget): value is Point {
  return 'x' in value && 'y' in value;
}

function normalizeOptionalPositiveNumber(
  value: number | undefined,
  field: string,
): number | undefined {
  return value === undefined ? undefined : normalizePositiveNumber(value, field);
}

function normalizePositiveNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError('INVALID_ARGS', `${field} must be a positive number`);
  }
  return value;
}

function normalizeOptionalPositiveInteger(
  value: number | undefined,
  field: string,
): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new AppError('INVALID_ARGS', `${field} must be a positive integer`);
  }
  return value;
}

function resolveSnapshotViewport(nodes: SnapshotState['nodes']): Rect {
  const visibleRects = nodes
    .filter((node) => isNodeVisibleInEffectiveViewport(node, nodes))
    .map((node) => node.rect)
    .filter(isUsableRect);
  const rects =
    visibleRects.length > 0 ? visibleRects : nodes.map((node) => node.rect).filter(isUsableRect);
  if (rects.length === 0) {
    throw new AppError('COMMAND_FAILED', 'Cannot infer viewport for directional swipe');
  }
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function isUsableRect(rect: SnapshotNode['rect']): rect is NonNullable<SnapshotNode['rect']> {
  return Boolean(rect && rect.width > 0 && rect.height > 0);
}

function toBackendResult(result: unknown): Record<string, unknown> | undefined {
  return result && typeof result === 'object' ? (result as Record<string, unknown>) : undefined;
}
