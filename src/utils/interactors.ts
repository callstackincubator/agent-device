import { AppError } from './errors.ts';
import type { DeviceInfo } from './device.ts';
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
  type(text: string): Promise<void>;
  fill(x: number, y: number, text: string): Promise<Record<string, unknown> | void>;
  scroll(direction: string, amount?: number): Promise<void>;
  scrollIntoView(text: string): Promise<{ attempts?: number } | void>;
  screenshot(outPath: string, appBundleId?: string): Promise<void>;
  back(): Promise<void>;
  home(): Promise<void>;
  appSwitcher(): Promise<void>;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  setSetting(
    setting: string,
    state: string,
    appId?: string,
    options?: PermissionSettingOptions,
  ): Promise<void>;
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
        type: (text) => typeAndroid(device, text),
        fill: (x, y, text) => fillAndroid(device, x, y, text),
        scroll: (direction, amount) => scrollAndroid(device, direction, amount),
        scrollIntoView: (text) => scrollIntoViewAndroid(device, text),
        screenshot: (outPath, _appBundleId) => screenshotAndroid(device, outPath),
        back: () => backAndroid(device),
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
        back: async () => {
          await runIosRunnerCommand(
            device,
            { command: 'back', appBundleId: runnerContext.appBundleId },
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

type RunnerOpts = {
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  requestId?: string;
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
      type: async (text) => {
        await runIosRunnerCommand(
          device,
          { command: 'type', text, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
      },
      fill: async (x, y, text) => {
        const tapResult = await runIosRunnerCommand(
          device,
          { command: 'tap', x, y, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
        await runIosRunnerCommand(
          device,
          { command: 'type', text, clearFirst: true, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
        return tapResult;
      },
      scroll: async (direction, _amount) => {
        if (!['up', 'down', 'left', 'right'].includes(direction)) {
          throw new AppError('INVALID_ARGS', `Unknown direction: ${direction}`);
        }
        const inverted = invertScrollDirection(direction as 'up' | 'down' | 'left' | 'right');
        await runIosRunnerCommand(
          device,
          { command: 'swipe', direction: inverted, appBundleId: ctx.appBundleId },
          runnerOpts,
        );
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
            await runIosRunnerCommand(
              device,
              { command: 'swipe', direction: 'up', appBundleId: ctx.appBundleId },
              runnerOpts,
            );
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

function invertScrollDirection(
  direction: 'up' | 'down' | 'left' | 'right',
): 'up' | 'down' | 'left' | 'right' {
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
