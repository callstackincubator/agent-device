import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
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
import {
  pressLinux,
  doubleClickLinux,
  swipeLinux,
  longPressLinux,
  focusLinux,
  typeLinux,
  fillLinux,
  scrollLinux,
} from '../platforms/linux/input-actions.ts';
import { screenshotLinux } from '../platforms/linux/screenshot.ts';
import {
  openLinuxApp,
  closeLinuxApp,
  backLinux,
  homeLinux,
} from '../platforms/linux/app-lifecycle.ts';
import { readLinuxClipboard, writeLinuxClipboard } from '../platforms/linux/clipboard.ts';
import type { Interactor, RunnerContext } from './interactor-types.ts';

export type {
  BackMode,
  Interactor,
  RunnerContext,
  ScreenshotOptions,
} from './interactor-types.ts';

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
        open: (app) => openLinuxApp(app),
        openDevice: () => Promise.resolve(),
        close: (app) => closeLinuxApp(app),
        tap: (x, y) => pressLinux(x, y),
        doubleTap: (x, y) => doubleClickLinux(x, y),
        swipe: (x1, y1, x2, y2, durationMs) => swipeLinux(x1, y1, x2, y2, durationMs),
        longPress: (x, y, durationMs) => longPressLinux(x, y, durationMs),
        focus: (x, y) => focusLinux(x, y),
        type: (text, delayMs) => typeLinux(text, delayMs),
        fill: (x, y, text, delayMs) => fillLinux(x, y, text, delayMs),
        scroll: (direction, options) => scrollLinux(direction, options),
        screenshot: (outPath) => screenshotLinux(outPath),
        back: () => backLinux(),
        home: () => homeLinux(),
        rotate: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'rotate not supported on Linux');
        },
        appSwitcher: () => {
          throw new AppError('UNSUPPORTED_OPERATION', 'appSwitcher not yet supported on Linux');
        },
        readClipboard: () => readLinuxClipboard(),
        writeClipboard: (text) => writeLinuxClipboard(text),
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
