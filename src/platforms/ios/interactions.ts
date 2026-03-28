import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { buildScrollGesturePlan, type ScrollDirection } from '../../core/scroll-gesture.ts';
import type { RunnerCommand } from './runner-client.ts';
import { runIosRunnerCommand } from './runner-client.ts';
import { createRequestCanceledError, isRequestCanceled } from '../../daemon/request-cancel.ts';
import { DEFAULT_SCROLL_INTO_VIEW_MAX_SCROLLS } from '../../utils/scroll-into-view.ts';
import type { BackMode, Interactor, RunnerContext } from '../../core/interactors.ts';

export type AppleBackRunnerCommand = 'backInApp' | 'backSystem';
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

type RunnerCommandExecutor = (command: RunnerCommand) => Promise<Record<string, unknown>>;
type IosRunnerOverrides = Pick<
  Interactor,
  | 'tap'
  | 'doubleTap'
  | 'swipe'
  | 'longPress'
  | 'focus'
  | 'type'
  | 'fill'
  | 'scroll'
  | 'scrollIntoView'
>;

export function resolveAppleBackRunnerCommand(mode?: BackMode): AppleBackRunnerCommand {
  if (mode === 'system') return 'backSystem';
  return 'backInApp';
}

export async function scrollIntoViewIosRunnerText(
  runCommand: RunnerCommandExecutor,
  throwIfCanceled: () => void,
  text: string,
  options?: { maxScrolls?: number },
): Promise<{ attempts?: number }> {
  const maxScrolls = options?.maxScrolls ?? DEFAULT_SCROLL_INTO_VIEW_MAX_SCROLLS;
  const initial = await runCommand({ command: 'findText', text });
  if (initial?.found) return { attempts: 0 };

  let previousSnapshot = snapshotProgressFingerprint(
    await runCommand({ command: 'snapshot', interactiveOnly: true, compact: true }),
  );

  for (let attempts = 1; attempts <= maxScrolls; attempts += 1) {
    throwIfCanceled();
    await runCommand({ command: 'swipe', direction: 'up' });
    // Small settle keeps gesture chain stable without long visible pauses.
    await new Promise((resolve) => setTimeout(resolve, 80));
    const found = await runCommand({ command: 'findText', text });
    if (found?.found) return { attempts };

    const snapshot = snapshotProgressFingerprint(
      await runCommand({ command: 'snapshot', interactiveOnly: true, compact: true }),
    );
    if (snapshot === previousSnapshot) {
      throw new AppError('COMMAND_FAILED', `scrollintoview could not find text: ${text}`, {
        reason: 'not_found',
        attempts,
        stalled: true,
      });
    }
    previousSnapshot = snapshot;
  }

  throw new AppError('COMMAND_FAILED', `scrollintoview could not find text: ${text}`, {
    reason: 'not_found',
    attempts: maxScrolls,
  });
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
  const throwIfCanceled = () => {
    if (!isRequestCanceled(ctx.requestId)) return;
    throw createRequestCanceledError();
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
          { command: 'type', text, delayMs, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
      },
      fill: async (x, y, text, delayMs) => {
        const tapResult = await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
        await runIosRunnerCommand(
          device,
          {
            command: 'type',
            x,
            y,
            text,
            clearFirst: true,
            delayMs,
            appBundleId: ctx.appBundleId,
          },
          runnerOpts,
        );
        return tapResult;
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
      scrollIntoView: async (text, options) => {
        return await scrollIntoViewIosRunnerText(
          (command) =>
            runIosRunnerCommand(device, { ...command, appBundleId: ctx.appBundleId }, runnerOpts),
          throwIfCanceled,
          text,
          options,
        );
      },
    },
  };
}

function snapshotProgressFingerprint(snapshot: Record<string, unknown>): string {
  const nodes = snapshot.nodes;
  return JSON.stringify(Array.isArray(nodes) ? nodes : snapshot);
}

function invertScrollDirection(direction: ScrollDirection): ScrollDirection {
  switch (direction) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
    default: {
      const _exhaustive: never = direction;
      return _exhaustive;
    }
  }
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
      {
        command: 'swipe',
        direction: invertScrollDirection(direction),
        appBundleId: ctx.appBundleId,
      },
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
