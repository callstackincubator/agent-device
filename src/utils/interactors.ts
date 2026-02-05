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
  scrollIntoView(text: string): Promise<void>;
  screenshot(outPath: string): Promise<void>;
};

export function getInteractor(device: DeviceInfo): Interactor {
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
    case 'ios':
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
    default:
      throw new AppError('UNSUPPORTED_PLATFORM', `Unsupported platform: ${device.platform}`);
  }
}
