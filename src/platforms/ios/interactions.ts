import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { buildScrollGesturePlan, type ScrollDirection } from '../../core/scroll-gesture.ts';
import { runIosRunnerCommand } from './runner-client.ts';
import type { RunnerCommand } from './runner-contract.ts';
import type { BackMode, Interactor, RunnerContext } from '../../core/interactor-types.ts';

export type AppleBackRunnerCommand = 'backInApp' | 'backSystem';
type AppleRemoteButton = NonNullable<RunnerCommand['remoteButton']>;
type RunIosRunnerCommand = typeof runIosRunnerCommand;
type RunnerOpts = {
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  requestId?: string;
};

type InteractionFrame = {
  originX: number;
  originY: number;
  referenceWidth: number;
  referenceHeight: number;
};

type NormalizedScrollOptions = {
  amount?: number;
  pixels?: number;
  preferProvidedPixels?: boolean;
};

type IosRunnerOverrides = Pick<
  Interactor,
  | 'tap'
  | 'tapElementSelector'
  | 'doubleTap'
  | 'swipe'
  | 'pan'
  | 'fling'
  | 'longPress'
  | 'focus'
  | 'type'
  | 'fill'
  | 'scroll'
  | 'pinch'
  | 'rotateGesture'
  | 'transformGesture'
>;

export function resolveAppleBackRunnerCommand(mode?: BackMode): AppleBackRunnerCommand {
  if (mode === 'system') return 'backSystem';
  return 'backInApp';
}

export function iosRunnerOverrides(
  device: DeviceInfo,
  ctx: RunnerContext,
): {
  overrides: IosRunnerOverrides;
  runnerOpts: RunnerOpts;
} {
  const runnerOpts = {
    verbose: ctx.verbose,
    logPath: ctx.logPath,
    traceLogPath: ctx.traceLogPath,
    requestId: ctx.requestId,
  };
  return {
    runnerOpts,
    overrides: {
      tap: async (x, y) => {
        return await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
      },
      tapElementSelector: async (selector) => {
        return await runIosRunnerCommand(
          device,
          {
            command: 'tap',
            selectorKey: selector.key,
            selectorValue: selector.value,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      doubleTap: async (x, y) => {
        return await runIosRunnerCommand(
          device,
          {
            command: 'tapSeries',
            x,
            y,
            count: 1,
            intervalMs: 0,
            doubleTap: true,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      swipe: async (x1, y1, x2, y2, durationMs) => {
        return await runIosRunnerCommand(
          device,
          { command: 'drag', x: x1, y: y1, x2, y2, durationMs, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
      },
      pan: async (x1, y1, x2, y2, durationMs) => {
        return await runIosRunnerCommand(
          device,
          {
            command: 'drag',
            x: x1,
            y: y1,
            x2,
            y2,
            durationMs: durationMs ?? 500,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      fling: async (x1, y1, x2, y2, durationMs) => {
        return await runIosRunnerCommand(
          device,
          {
            command: 'drag',
            x: x1,
            y: y1,
            x2,
            y2,
            durationMs: durationMs ?? 16,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      longPress: async (x, y, durationMs) => {
        return await runIosRunnerCommand(
          device,
          { command: 'longPress', x, y, durationMs, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
      },
      focus: async (x, y) => {
        return await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
      },
      type: async (text, delayMs) => {
        await runIosRunnerCommand(
          device,
          {
            command: 'type',
            text,
            delayMs,
            textEntryMode: 'append',
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      fill: async (x, y, text, delayMs) => {
        return await runIosRunnerCommand(
          device,
          {
            command: 'type',
            x,
            y,
            text,
            delayMs,
            textEntryMode: 'replace',
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      scroll: async (direction, options) => {
        return await runAppleScroll(
          runIosRunnerCommand,
          device,
          ctx,
          runnerOpts,
          direction,
          options,
        );
      },
      pinch: async (scale, x, y) => {
        await runIosRunnerCommand(
          device,
          {
            command: 'pinch',
            scale,
            x,
            y,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      rotateGesture: async (degrees, x, y, velocity) => {
        await runIosRunnerCommand(
          device,
          {
            command: 'rotateGesture',
            degrees,
            x,
            y,
            velocity,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
      transformGesture: async (options) => {
        return await runIosRunnerCommand(
          device,
          {
            command: 'transformGesture',
            x: options.x,
            y: options.y,
            dx: options.dx,
            dy: options.dy,
            scale: options.scale,
            degrees: options.degrees,
            durationMs: options.durationMs,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
      },
    },
  };
}

export function appleRemotePressCommand(
  remoteButton: AppleRemoteButton,
  appBundleId?: string,
  durationMs?: number,
): Parameters<RunIosRunnerCommand>[1] {
  return {
    command: 'remotePress',
    remoteButton,
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(appBundleId !== undefined ? { appBundleId } : {}),
  };
}

async function runAppleScroll(
  runRunnerCommand: RunIosRunnerCommand,
  device: DeviceInfo,
  ctx: RunnerContext,
  runnerOpts: RunnerOpts,
  direction: ScrollDirection,
  options?: { amount?: number; pixels?: number },
  interactionFrame?: InteractionFrame,
): Promise<Record<string, unknown>> {
  if (device.target === 'tv') {
    const runnerResult = await runRunnerCommand(
      device,
      appleRemotePressCommand(direction, ctx.appBundleId),
      runnerOpts,
    );
    return normalizeIosScrollResult(runnerResult, options);
  }

  const frame =
    interactionFrame ??
    (await resolveAppleInteractionFrame(runRunnerCommand, device, ctx, runnerOpts));
  const plan = buildScrollGesturePlan({
    direction,
    amount: options?.amount,
    pixels: options?.pixels,
    referenceWidth: frame.referenceWidth,
    referenceHeight: frame.referenceHeight,
  });
  const runnerResult = await runRunnerCommand(
    device,
    {
      command: 'drag',
      x: frame.originX + plan.x1,
      y: frame.originY + plan.y1,
      x2: frame.originX + plan.x2,
      y2: frame.originY + plan.y2,
      appBundleId: ctx.appBundleId,
    },
    runnerOpts,
  );
  return normalizeIosScrollResult(runnerResult, {
    amount: plan.amount,
    pixels: plan.pixels,
    preferProvidedPixels: true,
  });
}

async function resolveAppleInteractionFrame(
  runRunnerCommand: RunIosRunnerCommand,
  device: DeviceInfo,
  ctx: RunnerContext,
  runnerOpts: RunnerOpts,
): Promise<InteractionFrame> {
  const runnerResult = await runRunnerCommand(
    device,
    { command: 'interactionFrame', appBundleId: ctx.appBundleId },
    runnerOpts,
  );
  const originX = readFiniteNumber(runnerResult.x);
  const originY = readFiniteNumber(runnerResult.y);
  const referenceWidth = readFiniteNumber(runnerResult.referenceWidth);
  const referenceHeight = readFiniteNumber(runnerResult.referenceHeight);
  if (
    originX === undefined ||
    originY === undefined ||
    referenceWidth === undefined ||
    referenceHeight === undefined
  ) {
    throw new AppError('COMMAND_FAILED', 'interactionFrame did not return a usable frame');
  }
  return { originX, originY, referenceWidth, referenceHeight };
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeIosScrollResult(
  runnerResult: Record<string, unknown>,
  options?: NormalizedScrollOptions,
): Record<string, unknown> {
  const { x1, y1, x2, y2 } = remapRunnerCoordinates(runnerResult);
  const referenceWidth = readFiniteNumber(runnerResult.referenceWidth);
  const referenceHeight = readFiniteNumber(runnerResult.referenceHeight);
  const horizontalTravel =
    x1 !== undefined && x2 !== undefined ? Math.round(Math.abs(x2 - x1)) : undefined;
  const verticalTravel =
    y1 !== undefined && y2 !== undefined ? Math.round(Math.abs(y2 - y1)) : undefined;
  const travelPixels =
    options?.preferProvidedPixels && options.pixels !== undefined
      ? options.pixels
      : horizontalTravel && horizontalTravel > 0
        ? horizontalTravel
        : verticalTravel && verticalTravel > 0
          ? verticalTravel
          : undefined;

  return {
    ...(x1 !== undefined ? { x1 } : {}),
    ...(y1 !== undefined ? { y1 } : {}),
    ...(x2 !== undefined ? { x2 } : {}),
    ...(y2 !== undefined ? { y2 } : {}),
    ...(referenceWidth !== undefined ? { referenceWidth } : {}),
    ...(referenceHeight !== undefined ? { referenceHeight } : {}),
    ...(options?.amount !== undefined ? { amount: options.amount } : {}),
    ...(travelPixels !== undefined ? { pixels: travelPixels } : {}),
  };
}

function remapRunnerCoordinates(runnerResult: Record<string, unknown>): {
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
} {
  return {
    x1: readFiniteNumber(runnerResult.x),
    y1: readFiniteNumber(runnerResult.y),
    x2: readFiniteNumber(runnerResult.x2),
    y2: readFiniteNumber(runnerResult.y2),
  };
}
