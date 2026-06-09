import { closeHarmonyApp, openHarmonyApp } from '../../platforms/harmonyos/app-lifecycle.ts';
import {
  fillHarmony,
  focusHarmony,
  longPressHarmony,
  pressHarmony,
  doubleTapHarmony,
  pressBackHarmony,
  pressHomeHarmony,
  pressKeyHarmony,
  scrollHarmony,
  swipeHarmony,
  typeHarmony,
  rotateHarmony,
} from '../../platforms/harmonyos/input-actions.ts';
import { snapshotHarmony } from '../../platforms/harmonyos/snapshot.ts';
import { screenshotHarmony } from '../../platforms/harmonyos/screenshot.ts';
import { setHarmonySetting } from '../../platforms/harmonyos/settings.ts';
import {
  readHarmonyClipboardText,
  writeHarmonyClipboardText,
} from '../../platforms/harmonyos/clipboard.ts';
import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { Interactor } from '../interactor-types.ts';

export function createHarmonyInteractor(device: DeviceInfo): Interactor {
  return {
    open: (app, options) => openHarmonyApp(device, app, options?.activity),
    openDevice: async () => {
      // HarmonyOS doesn't have a "home screen" app; just press home
      await pressHomeHarmony(device);
    },
    close: (app) => closeHarmonyApp(device, app),
    tap: (x, y) => pressHarmony(device, x, y),
    doubleTap: (x, y) => doubleTapHarmony(device, x, y),
    swipe: (x1, y1, x2, y2, durationMs) =>
      swipeHarmony(device, { x: x1, y: y1 }, { x: x2, y: y2 }, durationMs),
    pan: (x1, y1, x2, y2, durationMs) =>
      swipeHarmony(device, { x: x1, y: y1 }, { x: x2, y: y2 }, durationMs),
    fling: (x1, y1, x2, y2, durationMs) =>
      swipeHarmony(device, { x: x1, y: y1 }, { x: x2, y: y2 }, durationMs),
    longPress: (x, y, durationMs) => longPressHarmony(device, x, y, durationMs ?? 1000),
    focus: (x, y) => focusHarmony(device, x, y),
    type: (text, _delayMs) => typeHarmony(device, text),
    fill: (x, y, text, delayMs) => fillHarmony(device, { x, y }, text, delayMs ?? 100),
    scroll: (direction, options) => scrollHarmony(device, direction, options),
    pinch: async () => { throw new Error('Pinch gesture not supported on HarmonyOS'); },
    rotateGesture: async () => { throw new Error('Rotate gesture not supported on HarmonyOS'); },
    transformGesture: async () => { throw new Error('Transform gesture not supported on HarmonyOS'); },
    screenshot: async (outPath, _options) => {
      await screenshotHarmony(device, outPath);
    },
    snapshot: async (options) => {
      const result = await withDiagnosticTimer(
        'snapshot_capture',
        async () =>
          await snapshotHarmony(device, {
            interactiveOnly: options?.interactiveOnly,
            compact: options?.compact,
            depth: options?.depth,
            scope: options?.scope,
            raw: options?.raw,
          }),
        { backend: 'harmonyos-arkui' },
      );
      return {
        nodes: result.nodes ?? [],
        truncated: result.truncated ?? false,
        backend: 'harmonyos-arkui',
        analysis: {
          rawNodeCount: result.rawNodeCount,
          maxDepth: result.maxDepth,
        },
      };
    },
    back: (_mode) => pressBackHarmony(device),
    home: () => pressHomeHarmony(device),
    rotate: (orientation) => rotateHarmony(device, orientation),
    appSwitcher: async () => {
      // App switcher via recent apps key
      await pressKeyHarmony(device, 'Recent');
    },
    readClipboard: async () => readHarmonyClipboardText(device),
    writeClipboard: async (text) => writeHarmonyClipboardText(device, text),
    setSetting: async (setting, state, appId, options) => {
      return await setHarmonySetting(device, setting, state, appId, options);
    },
  };
}
