import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
import type { DeviceRotation } from './device-rotation.ts';
import type { ScrollDirection } from './scroll-gesture.ts';
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
  rotateAndroid,
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
import { runMacOsScreenshotAction } from '../platforms/ios/macos-helper.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import {
  iosRunnerOverrides,
  resolveAppleBackRunnerCommand,
} from '../platforms/ios/interactions.ts';
import type { PermissionSettingOptions } from '../platforms/permission-utils.ts';
import type { SessionSurface } from './session-surface.ts';

export type RunnerContext = {
  requestId?: string;
  appBundleId?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
};

export type BackMode = 'in-app' | 'system';

export type ScreenshotOptions = {
  appBundleId?: string;
  fullscreen?: boolean;
  surface?: SessionSurface;
};

export type Interactor = {
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
  scrollIntoView(
    text: string,
    options?: { maxScrolls?: number },
  ): Promise<{ attempts?: number } | void>;
  screenshot(outPath: string, options?: ScreenshotOptions): Promise<void>;
  back(mode?: BackMode): Promise<void>;
  home(): Promise<void>;
  rotate(orientation: DeviceRotation): Promise<void>;
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
        scrollIntoView: (text, options) => scrollIntoViewAndroid(device, text, options),
        screenshot: (outPath) => screenshotAndroid(device, outPath),
        back: (_mode) => backAndroid(device),
        home: () => homeAndroid(device),
        rotate: (orientation) => rotateAndroid(device, orientation),
        appSwitcher: () => appSwitcherAndroid(device),
        readClipboard: () => readAndroidClipboardText(device),
        writeClipboard: (text) => writeAndroidClipboardText(device, text),
        setSetting: (setting, state, appId, options) =>
          setAndroidSetting(device, setting, state, appId, options),
      };
    case 'linux':
      return {
        open: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'open not yet supported on Linux');
        },
        openDevice: () => Promise.resolve(),
        close: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'close not yet supported on Linux');
        },
        tap: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'tap not yet supported on Linux');
        },
        doubleTap: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'doubleTap not yet supported on Linux');
        },
        swipe: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'swipe not yet supported on Linux');
        },
        longPress: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'longPress not yet supported on Linux');
        },
        focus: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'focus not yet supported on Linux');
        },
        type: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'type not yet supported on Linux');
        },
        fill: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'fill not yet supported on Linux');
        },
        scroll: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'scroll not yet supported on Linux');
        },
        scrollIntoView: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'scrollIntoView not yet supported on Linux');
        },
        screenshot: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'screenshot not yet supported on Linux');
        },
        back: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'back not yet supported on Linux');
        },
        home: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'home not yet supported on Linux');
        },
        rotate: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'rotate not supported on Linux');
        },
        appSwitcher: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'appSwitcher not yet supported on Linux');
        },
        readClipboard: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'readClipboard not yet supported on Linux');
        },
        writeClipboard: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'writeClipboard not yet supported on Linux');
        },
        setSetting: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'setSetting not supported on Linux');
        },
      };
    case 'ios':
    case 'macos': {
      const { overrides, runnerOpts } = iosRunnerOverrides(device, runnerContext);
      return {
        open: (app, options) =>
          openIosApp(device, app, { appBundleId: options?.appBundleId, url: options?.url }),
        openDevice: () => openIosDevice(device),
        close: (app) => closeIosApp(device, app),
        screenshot: async (outPath, options) => {
          if (device.platform === 'macos' && options?.surface && options.surface !== 'app') {
            await runMacOsScreenshotAction(outPath, {
              surface: options.surface,
              fullscreen: options.fullscreen,
            });
            return;
          }
          await screenshotIos(device, outPath, options?.appBundleId, options?.fullscreen);
        },
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
        rotate: async (orientation) => {
          await runIosRunnerCommand(
            device,
            { command: 'rotate', orientation, appBundleId: runnerContext.appBundleId },
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
