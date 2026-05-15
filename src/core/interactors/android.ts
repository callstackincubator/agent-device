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
  scrollAndroid,
  screenshotAndroid,
  setAndroidSetting,
  snapshotAndroid,
  swipeAndroid,
  typeAndroid,
  writeAndroidClipboardText,
} from '../../platforms/android/index.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { Interactor } from '../interactor-types.ts';

export function createAndroidInteractor(device: DeviceInfo): Interactor {
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
    screenshot: (outPath, options) => screenshotAndroid(device, outPath, options),
    snapshot: async (options) => {
      const result = await withDiagnosticTimer(
        'snapshot_capture',
        async () =>
          await snapshotAndroid(device, {
            interactiveOnly: options?.interactiveOnly,
            compact: options?.compact,
            depth: options?.depth,
            scope: options?.scope,
            raw: options?.raw,
          }),
        { backend: 'android' },
      );
      return {
        nodes: result.nodes ?? [],
        truncated: result.truncated ?? false,
        backend: 'android',
        analysis: result.analysis,
        androidSnapshot: result.androidSnapshot,
      };
    },
    back: (_mode) => backAndroid(device),
    home: () => homeAndroid(device),
    rotate: (orientation) => rotateAndroid(device, orientation),
    appSwitcher: () => appSwitcherAndroid(device),
    readClipboard: () => readAndroidClipboardText(device),
    writeClipboard: (text) => writeAndroidClipboardText(device, text),
    setSetting: (setting, state, appId, options) =>
      setAndroidSetting(device, setting, state, appId, options),
  };
}
