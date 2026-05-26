import { promises as fs } from 'node:fs';
import pathModule from 'node:path';
import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
import {
  dismissAndroidKeyboard,
  getAndroidKeyboardState,
} from '../platforms/android/device-input-state.ts';
import { pressAndroidEnter } from '../platforms/android/input-actions.ts';
import { pushAndroidNotification } from '../platforms/android/notifications.ts';
import { getInteractor } from './interactors.ts';
import type { Interactor, RunnerContext } from './interactor-types.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { clearIosSimulatorAppState, pushIosNotification } from '../platforms/ios/apps.ts';
import { isDeepLinkTarget } from './open-target.ts';
import { parseTriggerAppEventArgs, resolveAppEventUrl } from './app-events.ts';
import {
  LAUNCH_CONSOLE_DIRECT_APP_ONLY_MESSAGE,
  LAUNCH_CONSOLE_IOS_SIMULATOR_ONLY_MESSAGE,
} from './launch-console.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../utils/diagnostics.ts';
import { readLocationCoordinate } from '../utils/location-coordinates.ts';
import { successText, withSuccessText } from '../utils/success-text.ts';
import { screenshotOptionsFromFlags } from '../commands/capture-screenshot-options.ts';
import type { DispatchContext } from './dispatch-context.ts';
import {
  handleFillCommand,
  handleFlingCommand,
  handleFocusCommand,
  handleLongPressCommand,
  handlePanCommand,
  handlePinchCommand,
  handlePressCommand,
  handleReadCommand,
  handleRotateGestureCommand,
  handleScrollCommand,
  handleSwipeCommand,
  handleTransformGestureCommand,
  handleTypeCommand,
} from './dispatch-interactions.ts';
import { readNotificationPayload } from './dispatch-payload.ts';
import { parseDeviceRotation } from './device-rotation.ts';

export { resolveTargetDevice } from './dispatch-resolve.ts';
export type { BatchStep, CommandFlags, DispatchContext } from './dispatch-context.ts';

type DispatchCommandHandlerParams = {
  device: DeviceInfo;
  interactor: Interactor;
  positionals: string[];
  outPath?: string;
  context?: DispatchContext;
  runnerCtx: RunnerContext;
};

type DispatchCommandHandler = (
  params: DispatchCommandHandlerParams,
) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;

const DISPATCH_COMMAND_HANDLERS: Record<string, DispatchCommandHandler> = {
  open: ({ device, interactor, positionals, context }) =>
    handleOpenCommand(device, interactor, positionals, context),
  close: async ({ interactor, positionals }) => {
    const app = positionals[0];
    if (!app) {
      return { closed: 'session', ...successText('Closed session') };
    }
    await interactor.close(app);
    return { app, ...successText(`Closed: ${app}`) };
  },
  press: ({ device, interactor, positionals, context }) =>
    handlePressCommand(device, interactor, positionals, context),
  swipe: ({ device, interactor, positionals, context }) =>
    handleSwipeCommand(device, interactor, positionals, context),
  pan: ({ interactor, positionals }) => handlePanCommand(interactor, positionals),
  fling: ({ interactor, positionals }) => handleFlingCommand(interactor, positionals),
  longpress: ({ interactor, positionals }) => handleLongPressCommand(interactor, positionals),
  focus: ({ interactor, positionals }) => handleFocusCommand(interactor, positionals),
  type: ({ interactor, positionals, context }) =>
    handleTypeCommand(interactor, positionals, context),
  fill: ({ interactor, positionals, context }) =>
    handleFillCommand(interactor, positionals, context),
  scroll: ({ interactor, positionals, context }) =>
    handleScrollCommand(interactor, positionals, context),
  pinch: ({ device, interactor, positionals, context }) =>
    handlePinchCommand(device, interactor, positionals, context),
  'rotate-gesture': ({ device, interactor, positionals }) =>
    handleRotateGestureCommand(device, interactor, positionals),
  'transform-gesture': ({ device, interactor, positionals }) =>
    handleTransformGestureCommand(device, interactor, positionals),
  'trigger-app-event': async ({ device, interactor, positionals, context }) => {
    const { eventName, payload } = parseTriggerAppEventArgs(positionals);
    const eventUrl = resolveAppEventUrl(device.platform, eventName, payload);
    await interactor.open(eventUrl, { appBundleId: context?.appBundleId });
    return {
      event: eventName,
      eventUrl,
      transport: 'deep-link',
      ...successText(`Triggered app event: ${eventName}`),
    };
  },
  screenshot: async ({ interactor, positionals, outPath, context }) => {
    const positionalPath = positionals[0];
    const screenshotPath = positionalPath ?? outPath ?? `./screenshot-${Date.now()}.png`;
    await fs.mkdir(pathModule.dirname(screenshotPath), { recursive: true });
    const screenshotOptions = screenshotOptionsFromFlags(context);
    await interactor.screenshot(screenshotPath, {
      appBundleId: context?.appBundleId,
      fullscreen: screenshotOptions.fullscreen,
      stabilize: screenshotOptions.stabilize,
      surface: context?.surface,
    });
    return { path: screenshotPath, ...successText(`Saved screenshot: ${screenshotPath}`) };
  },
  back: async ({ interactor, context }) => {
    await interactor.back(context?.backMode);
    return { action: 'back', mode: context?.backMode ?? 'in-app', ...successText('Back') };
  },
  home: async ({ interactor }) => {
    await interactor.home();
    return { action: 'home', ...successText('Home') };
  },
  rotate: async ({ interactor, positionals }) => {
    const orientation = parseDeviceRotation(positionals[0]);
    await interactor.rotate(orientation);
    return {
      action: 'rotate',
      orientation,
      ...successText(`Rotated to ${orientation}`),
    };
  },
  'app-switcher': async ({ interactor }) => {
    await interactor.appSwitcher();
    return { action: 'app-switcher', ...successText('Opened app switcher') };
  },
  clipboard: ({ interactor, positionals }) => handleClipboardCommand(interactor, positionals),
  keyboard: ({ device, positionals, context, runnerCtx }) =>
    handleKeyboardCommand(device, positionals, context, runnerCtx),
  settings: ({ device, interactor, positionals, context }) =>
    handleSettingsCommand(device, interactor, positionals, context),
  push: ({ device, positionals, context }) => handlePushCommand(device, positionals, context),
  snapshot: ({ interactor, context }) => handleSnapshotCommand(interactor, context),
  read: ({ device, positionals, context }) => handleReadCommand(device, positionals, context),
};

export async function dispatchCommand(
  device: DeviceInfo,
  command: string,
  positionals: string[],
  outPath?: string,
  context?: DispatchContext,
): Promise<Record<string, unknown> | void> {
  const runnerCtx: RunnerContext = {
    requestId: context?.requestId,
    appBundleId: context?.appBundleId,
    verbose: context?.verbose,
    logPath: context?.logPath,
    traceLogPath: context?.traceLogPath,
  };
  const interactor = getInteractor(device, runnerCtx);
  emitDiagnostic({
    level: 'debug',
    phase: 'platform_command_prepare',
    data: {
      command,
      platform: device.platform,
      kind: device.kind,
    },
  });
  return await withDiagnosticTimer(
    'platform_command',
    async () => {
      const handler = DISPATCH_COMMAND_HANDLERS[command];
      if (!handler) throw new AppError('INVALID_ARGS', `Unknown command: ${command}`);
      return await handler({ device, interactor, positionals, outPath, context, runnerCtx });
    },
    {
      command,
      platform: device.platform,
    },
  );
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

// fallow-ignore-next-line complexity
async function handleOpenCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const app = positionals[0];
  const url = positionals[1];
  const launchConsole = context?.launchConsole;
  if (positionals.length > 2) {
    throw new AppError('INVALID_ARGS', 'open accepts at most two arguments: <app|url> [url]');
  }
  if (!app) {
    if (launchConsole) {
      throw new AppError('INVALID_ARGS', '--launch-console requires an app target');
    }
    await interactor.openDevice();
    return { app: null, ...successText('Opened device') };
  }
  if (launchConsole && (device.platform !== 'ios' || device.kind !== 'simulator')) {
    throw new AppError('UNSUPPORTED_OPERATION', LAUNCH_CONSOLE_IOS_SIMULATOR_ONLY_MESSAGE);
  }
  if (url !== undefined) {
    if (device.platform === 'android') {
      throw new AppError('INVALID_ARGS', 'open <app> <url> is supported only on Apple platforms');
    }
    if (isDeepLinkTarget(app)) {
      throw new AppError(
        'INVALID_ARGS',
        'open <app> <url> requires an app target as the first argument',
      );
    }
    if (!isDeepLinkTarget(url)) {
      throw new AppError('INVALID_ARGS', 'open <app> <url> requires a valid URL target');
    }
    if (launchConsole) {
      throw new AppError('INVALID_ARGS', LAUNCH_CONSOLE_DIRECT_APP_ONLY_MESSAGE);
    }
    await interactor.open(app, {
      activity: context?.activity,
      appBundleId: context?.appBundleId,
      launchArgs: context?.launchArgs,
      url,
    });
    return { app, url, ...successText(`Opened: ${app}`) };
  }
  if (launchConsole && isDeepLinkTarget(app)) {
    throw new AppError('INVALID_ARGS', LAUNCH_CONSOLE_DIRECT_APP_ONLY_MESSAGE);
  }
  if (device.platform === 'android' && context?.launchArgs && context.launchArgs.length > 0) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'Launch arguments are currently supported only on Apple platforms.',
    );
  }
  if (context?.clearAppState) {
    if (isDeepLinkTarget(app)) {
      throw new AppError(
        'INVALID_ARGS',
        'Clearing app state requires an app target, not a deep link.',
      );
    }
    if (device.platform !== 'ios' || device.kind !== 'simulator') {
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        'Clearing app state is currently supported only on iOS simulators.',
      );
    }
    await clearIosSimulatorAppState(device, app);
  }
  await interactor.open(app, {
    activity: context?.activity,
    appBundleId: context?.appBundleId,
    launchConsole,
    launchArgs: context?.launchArgs,
  });
  return { app, ...(launchConsole ? { launchConsole } : {}), ...successText(`Opened: ${app}`) };
}

async function handleClipboardCommand(
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action !== 'read' && action !== 'write') {
    throw new AppError('INVALID_ARGS', 'clipboard requires a subcommand: read or write');
  }
  if (action === 'read') {
    if (positionals.length !== 1) {
      throw new AppError('INVALID_ARGS', 'clipboard read does not accept additional arguments');
    }
    const text = await interactor.readClipboard();
    return { action, text };
  }
  if (positionals.length < 2) {
    throw new AppError('INVALID_ARGS', 'clipboard write requires text (use "" to clear clipboard)');
  }
  const text = positionals.slice(1).join(' ');
  await interactor.writeClipboard(text);
  return {
    action,
    textLength: Array.from(text).length,
    ...successText('Clipboard updated'),
  };
}

async function handleKeyboardCommand(
  device: DeviceInfo,
  positionals: string[],
  context: DispatchContext | undefined,
  runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  const action = (positionals[0] ?? 'status').toLowerCase();
  if (!isKeyboardAction(action)) {
    throw new AppError(
      'INVALID_ARGS',
      'keyboard requires a subcommand: status, get, dismiss, enter, or return',
    );
  }
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'keyboard accepts at most one subcommand argument');
  }
  if (device.platform === 'android') {
    return await handleAndroidKeyboardCommand(device, action);
  }
  if (device.platform === 'ios') {
    return await handleIosKeyboardCommand(device, action, context, runnerCtx);
  }
  throw new AppError('UNSUPPORTED_OPERATION', 'keyboard is supported only on Android and iOS');
}

function isKeyboardAction(
  action: string,
): action is 'status' | 'get' | 'dismiss' | 'enter' | 'return' {
  return (
    action === 'status' ||
    action === 'get' ||
    action === 'dismiss' ||
    action === 'enter' ||
    action === 'return'
  );
}

async function handleAndroidKeyboardCommand(
  device: DeviceInfo,
  action: 'status' | 'get' | 'dismiss' | 'enter' | 'return',
): Promise<Record<string, unknown>> {
  if (action === 'enter' || action === 'return') {
    await pressAndroidEnter(device);
    return {
      platform: 'android',
      action: 'enter',
      ...successText('Keyboard enter pressed'),
    };
  }
  if (action === 'dismiss') {
    const result = await dismissAndroidKeyboard(device);
    return {
      platform: 'android',
      action: 'dismiss',
      attempts: result.attempts,
      wasVisible: result.wasVisible,
      dismissed: result.dismissed,
      visible: result.visible,
      inputType: result.inputType,
      type: result.type,
      inputMethodPackage: result.inputMethodPackage,
      focusedPackage: result.focusedPackage,
      focusedResourceId: result.focusedResourceId,
      inputOwner: result.inputOwner,
    };
  }
  const state = await getAndroidKeyboardState(device);
  return {
    platform: 'android',
    action: 'status',
    visible: state.visible,
    inputType: state.inputType,
    type: state.type,
    inputMethodPackage: state.inputMethodPackage,
    focusedPackage: state.focusedPackage,
    focusedResourceId: state.focusedResourceId,
    inputOwner: state.inputOwner,
  };
}

async function handleIosKeyboardCommand(
  device: DeviceInfo,
  action: 'status' | 'get' | 'dismiss' | 'enter' | 'return',
  context: DispatchContext | undefined,
  runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  if (action !== 'dismiss' && action !== 'enter' && action !== 'return') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'keyboard status/get is currently supported only on Android; use keyboard dismiss or enter on iOS',
    );
  }
  if (action === 'enter' || action === 'return') {
    const result = await runIosRunnerCommand(
      device,
      { command: 'keyboardReturn', appBundleId: context?.appBundleId },
      runnerCtx,
    );
    return {
      platform: 'ios',
      action: 'enter',
      visible: result.visible,
      wasVisible: result.wasVisible,
      ...successText('Keyboard enter pressed'),
    };
  }
  const result = await runIosRunnerCommand(
    device,
    { command: 'keyboardDismiss', appBundleId: context?.appBundleId },
    runnerCtx,
  );
  return {
    platform: 'ios',
    action: 'dismiss',
    wasVisible: result.wasVisible,
    dismissed: result.dismissed,
    visible: result.visible,
    ...successText(result.dismissed ? 'Keyboard dismissed' : 'Keyboard already hidden'),
  };
}

async function handleSettingsCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const [setting, state, target, mode] = positionals;
  const isLocationSet = setting === 'location' && state === 'set';
  const usesPayloadAppBundleSlot = setting === 'permission' || isLocationSet;
  const appBundleId =
    (usesPayloadAppBundleSlot ? positionals[4] : positionals[2]) ?? context?.appBundleId;
  const settingOptions =
    setting === 'permission'
      ? {
          permissionTarget: target,
          permissionMode: mode,
        }
      : isLocationSet
        ? {
            latitude: readLocationCoordinate(target, 'latitude'),
            longitude: readLocationCoordinate(mode, 'longitude'),
          }
        : undefined;
  const diagnosticPayload = isLocationSet
    ? { setting, state, latitude: target, longitude: mode, platform: device.platform }
    : setting === 'permission'
      ? {
          setting,
          state,
          permissionTarget: target,
          permissionMode: mode,
          platform: device.platform,
        }
      : { setting, state, appBundleId, platform: device.platform };
  emitDiagnostic({
    level: 'debug',
    phase: 'settings_apply',
    data: diagnosticPayload,
  });
  const result = await interactor.setSetting(setting, state, appBundleId, settingOptions);
  return result && typeof result === 'object'
    ? withSuccessText(
        { setting, state, ...result },
        readResultMessage(result) ?? `Updated setting: ${setting}`,
      )
    : { setting, state, ...successText(`Updated setting: ${setting}`) };
}

async function handlePushCommand(
  device: DeviceInfo,
  positionals: string[],
  _context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const target = positionals[0]?.trim();
  const payloadArg = positionals[1]?.trim();
  if (!target || !payloadArg) {
    throw new AppError('INVALID_ARGS', 'push requires <bundle|package> <payload.json|inline-json>');
  }
  const payload = await readNotificationPayload(payloadArg);
  if (device.platform === 'ios') {
    await pushIosNotification(device, target, payload);
    return {
      platform: 'ios',
      bundleId: target,
      ...successText(`Pushed notification to ${target}`),
    };
  }
  const androidResult = await pushAndroidNotification(device, target, payload);
  return {
    platform: 'android',
    package: target,
    action: androidResult.action,
    extrasCount: androidResult.extrasCount,
    ...successText(`Pushed notification to ${target}`),
  };
}

async function handleSnapshotCommand(
  interactor: Interactor,
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  return await interactor.snapshot({
    appBundleId: context?.appBundleId,
    interactiveOnly: context?.snapshotInteractiveOnly,
    compact: context?.snapshotCompact,
    depth: context?.snapshotDepth,
    scope: context?.snapshotScope,
    raw: context?.snapshotRaw,
    surface: context?.surface,
  });
}

function readResultMessage(result: Record<string, unknown>): string | undefined {
  return typeof result.message === 'string' && result.message.length > 0
    ? result.message
    : undefined;
}
