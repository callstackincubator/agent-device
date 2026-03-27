import { AppError } from './errors.ts';
import type { DeviceInfo } from './device.ts';
import { buildScrollGesturePlan, type ScrollDirection } from '../core/scroll-gesture.ts';
import {
  appSwitcherAndroid,
  backAndroid,
  closeAndroidApp,
  fillAndroid,
  focusAndroid,
  homeAndroid,
  longPressAndroid,
  openAndroidApp,
  openAndroidDevice,
  pressAndroid,
  readAndroidClipboardText,
  swipeAndroid,
  scrollAndroid,
  scrollIntoViewAndroid,
  screenshotAndroid,
  setAndroidSetting,
  typeAndroid,
  writeAndroidClipboardText,
} from '../platforms/android/index.ts';
import {
  closeIosApp,
  openIosApp,
  openIosDevice,
  readIosClipboardText,
  screenshotIos,
  setIosSetting,
  writeIosClipboardText,
} from '../platforms/ios/index.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { createRequestCanceledError, isRequestCanceled } from '../daemon/request-cancel.ts';
import type { PermissionSettingOptions } from '../platforms/permission-utils.ts';

export type RunnerContext = {
  requestId?: string;
  appBundleId?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
};

export type BackMode = 'in-app' | 'system';
export type AppleBackRunnerCommand = 'backInApp' | 'backSystem';

type Interactor = {
  open(
    app: string,
    options?: { activity?: string; appBundleId?: string; url?: string },
  ): Promise<void>;
  openDevice(): Promise<void>;
  close(app: string): Promise<void>;
  tap(x: number, y: number): Promise<Record<string, unknown> | void>;
  doubleTap(x: number, y: number): Promise<Record<string, unknown> | void>;
  swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs?: number,
  ): Promise<Record<string, unknown> | void>;
  longPress(x: number, y: number, durationMs?: number): Promise<Record<string, unknown> | void>;
  focus(x: number, y: number): Promise<Record<string, unknown> | void>;
  type(text: string, delayMs?: number): Promise<void>;
  fill(
    x: number,
    y: number,
    text: string,
    delayMs?: number,
  ): Promise<Record<string, unknown> | void>;
  scroll(
    direction: ScrollDirection,
    options?: { amount?: number; pixels?: number },
  ): Promise<Record<string, unknown> | void>;
  scrollIntoView(text: string): Promise<{ attempts?: number } | void>;
  screenshot(outPath: string, appBundleId?: string): Promise<void>;
  back(mode?: BackMode): Promise<void>;
  home(): Promise<void>;
  appSwitcher(): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  setSetting(
    setting: string,
    state: string,
    appId?: string,
    options?: PermissionSettingOptions,
  ): Promise<Record<string, unknown> | void>;
};

export function getInteractor(device: DeviceInfo, runnerContext: RunnerContext): Interactor {
  switch (device.platform) {
    case 'android':
      return {
        open: (app, options) => openAndroidApp(device, app, options?.activity),
        openDevice: () => openAndroidDevice(device),
        close: (app) => closeAndroidApp(device, app),
        tap: (x, y) => pressAndroid(device, x, y),
        doubleTap: async (x, y) => {
          await pressAndroid(device, x, y);
          await pressAndroid(device, x, y);
        },
        swipe: (x1, y1, x2, y2, durationMs) => swipeAndroid(device, x1, y1, x2, y2, durationMs),
        longPress: (x, y, durationMs) => longPressAndroid(device, x, y, durationMs),
        focus: (x, y) => focusAndroid(device, x, y),
        type: (text, delayMs) => typeAndroid(device, text, delayMs),
        fill: (x, y, text, delayMs) => fillAndroid(device, x, y, text, delayMs),
        scroll: (direction, options) => scrollAndroid(device, direction, options),
        scrollIntoView: (text) => scrollIntoViewAndroid(device, text),
        screenshot: (outPath, _appBundleId) => screenshotAndroid(device, outPath),
        back: (_mode) => backAndroid(device),
        home: () => homeAndroid(device),
        appSwitcher: () => appSwitcherAndroid(device),
        readClipboard: () => readAndroidClipboardText(device),
        writeClipboard: (text) => writeAndroidClipboardText(device, text),
        setSetting: (setting, state, appId, options) =>
          setAndroidSetting(device, setting, state, appId, options),
      };
    case 'ios':
    case 'macos': {
      const { overrides, runnerOpts } = iosRunnerOverrides(device, runnerContext);
      return {
        open: (app, options) =>
          openIosApp(device, app, { appBundleId: options?.appBundleId, url: options?.url }),
        openDevice: () => openIosDevice(device),
        close: (app) => closeIosApp(device, app),
        screenshot: (outPath, appBundleId) => screenshotIos(device, outPath, appBundleId),
        back: async (mode) => {
          await runIosRunnerCommand(
            device,
            {
              command: resolveAppleBackRunnerCommand(mode),
              appBundleId: runnerContext.appBundleId,
            },
            runnerOpts,
          );
        },
        home: async () => {
          await runIosRunnerCommand(
            device,
            { command: 'home', appBundleId: runnerContext.appBundleId },
            runnerOpts,
          );
        },
        appSwitcher: async () => {
          await runIosRunnerCommand(
            device,
            { command: 'appSwitcher', appBundleId: runnerContext.appBundleId },
            runnerOpts,
          );
        },
        readClipboard: () => readIosClipboardText(device),
        writeClipboard: (text) => writeIosClipboardText(device, text),
        setSetting: (setting, state, appId, options) =>
          setIosSetting(device, setting, state, appId, options),
        ...overrides,
      };
    }
    default:
      throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform: ${device.platform}`);
  }
}

export function resolveAppleBackRunnerCommand(mode?: BackMode): AppleBackRunnerCommand {
  if (mode === 'system') return 'backSystem';
  return 'backInApp';
}

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

type IoRunnerOverrides = Pick<
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

function iosRunnerOverrides(
  device: DeviceInfo,
  ctx: RunnerContext,
): { overrides: IoRunnerOverrides; runnerOpts: RunnerOpts } {
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
          { command: 'type', text, clearFirst: true, delayMs, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
        return tapResult;
      },
      scroll: async (direction, options) => {
        return await runAppleScroll(device, ctx, runnerOpts, direction, options);
      },
      scrollIntoView: async (text) => {
        // Check once, then scroll in bursts to avoid slow find->swipe->find cadence on heavy screens.
        const initial = (await runIosRunnerCommand(
          device,
          { command: 'findText', text, appBundleId: ctx.appBundleId },
          runnerOpts,
        )) as { found?: boolean };
        if (initial?.found) return { attempts: 1 };

        const maxBursts = 12;
        const swipesPerBurst = 4;
        for (let burst = 0; burst < maxBursts; burst += 1) {
          for (let i = 0; i < swipesPerBurst; i += 1) {
            throwIfCanceled();
            await runAppleScroll(device, ctx, runnerOpts, 'down');
            // Small settle keeps gesture chain stable without long visible pauses.
            await new Promise((resolve) => setTimeout(resolve, 80));
          }
          throwIfCanceled();
          const found = (await runIosRunnerCommand(
            device,
            { command: 'findText', text, appBundleId: ctx.appBundleId },
            runnerOpts,
          )) as { found?: boolean };
          if (found?.found) return { attempts: burst + 2 };
        }
        throw new AppError('COMMAND_FAILED', `scrollintoview could not find text: ${text}`);
      },
    },
  };
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
  }
  const _exhaustive: never = direction;
  return _exhaustive;
}

async function runAppleScroll(
  device: DeviceInfo,
  ctx: RunnerContext,
  runnerOpts: RunnerOpts,
  direction: ScrollDirection,
  options?: { amount?: number; pixels?: number },
): Promise<Record<string, unknown>> {
  if (device.target === 'tv') {
    const runnerResult = await runIosRunnerCommand(
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

  const frame = await resolveAppleInteractionFrame(device, ctx, runnerOpts);
  const plan = buildScrollGesturePlan({
    direction,
    amount: options?.amount,
    pixels: options?.pixels,
    referenceWidth: frame.referenceWidth,
    referenceHeight: frame.referenceHeight,
  });
  const runnerResult = await runIosRunnerCommand(
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
  });
}

async function resolveAppleInteractionFrame(
  device: DeviceInfo,
  ctx: RunnerContext,
  runnerOpts: RunnerOpts,
): Promise<InteractionFrame> {
  const runnerResult = await runIosRunnerCommand(
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
  options?: { amount?: number; pixels?: number },
): Record<string, unknown> {
  const { x1, y1, x2, y2 } = remapRunnerCoordinates(runnerResult);
  const referenceWidth = readFiniteNumber(runnerResult.referenceWidth);
  const referenceHeight = readFiniteNumber(runnerResult.referenceHeight);
  const horizontalTravel =
    x1 !== undefined && x2 !== undefined ? Math.round(Math.abs(x2 - x1)) : undefined;
  const verticalTravel =
    y1 !== undefined && y2 !== undefined ? Math.round(Math.abs(y2 - y1)) : undefined;
  const travelPixels =
    horizontalTravel && horizontalTravel > 0
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
