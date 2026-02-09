import { AppError } from './errors.ts';
import type { DeviceInfo } from './device.ts';
import {
  closeAndroidApp,
  fillAndroid,
  focusAndroid,
  longPressAndroid,
  openAndroidApp,
  openAndroidDevice,
  pressAndroid,
  scrollAndroid,
  scrollIntoViewAndroid,
  screenshotAndroid,
  typeAndroid,
} from '../platforms/android/index.ts';
import {
  closeIosApp,
  fillIos,
  focusIos,
  longPressIos,
  openIosApp,
  openIosDevice,
  pressIos,
  scrollIos,
  scrollIntoViewIos,
  screenshotIos,
  typeIos,
} from '../platforms/ios/index.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';

export type RunnerContext = {
  appBundleId?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
};

export type Interactor = {
  open(app: string, options?: { activity?: string }): Promise<void>;
  openDevice(): Promise<void>;
  close(app: string): Promise<void>;
  tap(x: number, y: number): Promise<void>;
  longPress(x: number, y: number, durationMs?: number): Promise<void>;
  focus(x: number, y: number): Promise<void>;
  type(text: string): Promise<void>;
  fill(x: number, y: number, text: string): Promise<void>;
  scroll(direction: string, amount?: number): Promise<void>;
  scrollIntoView(text: string): Promise<{ attempts?: number } | void>;
  screenshot(outPath: string): Promise<void>;
};

export function getInteractor(device: DeviceInfo, runnerContext?: RunnerContext): Interactor {
  switch (device.platform) {
    case 'android':
      return {
        open: (app, options) => openAndroidApp(device, app, options?.activity),
        openDevice: () => openAndroidDevice(device),
        close: (app) => closeAndroidApp(device, app),
        tap: (x, y) => pressAndroid(device, x, y),
        longPress: (x, y, durationMs) => longPressAndroid(device, x, y, durationMs),
        focus: (x, y) => focusAndroid(device, x, y),
        type: (text) => typeAndroid(device, text),
        fill: (x, y, text) => fillAndroid(device, x, y, text),
        scroll: (direction, amount) => scrollAndroid(device, direction, amount),
        scrollIntoView: (text) => scrollIntoViewAndroid(device, text),
        screenshot: (outPath) => screenshotAndroid(device, outPath),
      };
    case 'ios': {
      if (device.kind === 'simulator' && runnerContext) {
        return createIosSimulatorInteractor(device, runnerContext);
      }
      return {
        open: (app) => openIosApp(device, app),
        openDevice: () => openIosDevice(device),
        close: (app) => closeIosApp(device, app),
        tap: (x, y) => pressIos(device, x, y),
        longPress: (x, y, durationMs) => longPressIos(device, x, y, durationMs),
        focus: (x, y) => focusIos(device, x, y),
        type: (text) => typeIos(device, text),
        fill: (x, y, text) => fillIos(device, x, y, text),
        scroll: (direction, amount) => scrollIos(device, direction, amount),
        scrollIntoView: (text) => scrollIntoViewIos(text),
        screenshot: (outPath) => screenshotIos(device, outPath),
      };
    }
    default:
      throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform: ${device.platform}`);
  }
}

function createIosSimulatorInteractor(device: DeviceInfo, ctx: RunnerContext): Interactor {
  const runnerOpts = { verbose: ctx.verbose, logPath: ctx.logPath, traceLogPath: ctx.traceLogPath };

  return {
    open: (app) => openIosApp(device, app),
    openDevice: () => openIosDevice(device),
    close: (app) => closeIosApp(device, app),
    tap: async (x, y) => {
      await runIosRunnerCommand(
        device,
        { command: 'tap', x, y, appBundleId: ctx.appBundleId },
        runnerOpts,
      );
    },
    longPress: async (x, y, durationMs) => {
      await runIosRunnerCommand(
        device,
        { command: 'longPress', x, y, durationMs, appBundleId: ctx.appBundleId },
        runnerOpts,
      );
    },
    focus: async (x, y) => {
      await runIosRunnerCommand(
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
      await runIosRunnerCommand(
        device,
        { command: 'tap', x, y, appBundleId: ctx.appBundleId },
        runnerOpts,
      );
      await runIosRunnerCommand(
        device,
        { command: 'type', text, clearFirst: true, appBundleId: ctx.appBundleId },
        runnerOpts,
      );
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
      const maxAttempts = 8;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const found = (await runIosRunnerCommand(
          device,
          { command: 'findText', text, appBundleId: ctx.appBundleId },
          runnerOpts,
        )) as { found?: boolean };
        if (found?.found) return { attempts: attempt + 1 };
        await runIosRunnerCommand(
          device,
          { command: 'swipe', direction: 'up', appBundleId: ctx.appBundleId },
          runnerOpts,
        );
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      throw new AppError('COMMAND_FAILED', `scrollintoview could not find text: ${text}`);
    },
    screenshot: (outPath) => screenshotIos(device, outPath),
  };
}

function invertScrollDirection(direction: 'up' | 'down' | 'left' | 'right'): 'up' | 'down' | 'left' | 'right' {
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
