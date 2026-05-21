import { promises as fs } from 'node:fs';
import pathModule from 'node:path';
import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
import {
  dismissAndroidKeyboard,
  getAndroidKeyboardState,
} from '../platforms/android/device-input-state.ts';
import { pushAndroidNotification } from '../platforms/android/notifications.ts';
import { getInteractor } from './interactors.ts';
import type { Interactor, RunnerContext } from './interactor-types.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { pushIosNotification } from '../platforms/ios/apps.ts';
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
  handleFocusCommand,
  handleLongPressCommand,
  handlePinchCommand,
  handlePressCommand,
  handleReadCommand,
  handleScrollCommand,
  handleSwipeCommand,
  handleTypeCommand,
} from './dispatch-interactions.ts';
import { readNotificationPayload } from './dispatch-payload.ts';
import { parseDeviceRotation } from './device-rotation.ts';

export { resolveTargetDevice } from './dispatch-resolve.ts';
export type { BatchStep, CommandFlags, DispatchContext } from './dispatch-context.ts';

// fallow-ignore-next-line complexity
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
      switch (command) {
        case 'open':
          return handleOpenCommand(device, interactor, positionals, context);
        case 'close': {
          const app = positionals[0];
          if (!app) {
            return { closed: 'session', ...successText('Closed session') };
          }
          await interactor.close(app);
          return { app, ...successText(`Closed: ${app}`) };
        }
        case 'press':
          return handlePressCommand(device, interactor, positionals, context);
        case 'swipe':
          return handleSwipeCommand(device, interactor, positionals, context);
        case 'longpress':
          return handleLongPressCommand(interactor, positionals);
        case 'focus':
          return handleFocusCommand(interactor, positionals);
        case 'type':
          return handleTypeCommand(interactor, positionals, context);
        case 'fill':
          return handleFillCommand(interactor, positionals, context);
        case 'scroll':
          return handleScrollCommand(interactor, positionals, context);
        case 'pinch':
          return handlePinchCommand(device, positionals, context);
        case 'trigger-app-event': {
          const { eventName, payload } = parseTriggerAppEventArgs(positionals);
          const eventUrl = resolveAppEventUrl(device.platform, eventName, payload);
          await interactor.open(eventUrl, { appBundleId: context?.appBundleId });
          return {
            event: eventName,
            eventUrl,
            transport: 'deep-link',
            ...successText(`Triggered app event: ${eventName}`),
          };
        }
        case 'screenshot': {
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
        }
        case 'back':
          await interactor.back(context?.backMode);
          return { action: 'back', mode: context?.backMode ?? 'in-app', ...successText('Back') };
        case 'home':
          await interactor.home();
          return { action: 'home', ...successText('Home') };
        case 'rotate': {
          const orientation = parseDeviceRotation(positionals[0]);
          await interactor.rotate(orientation);
          return {
            action: 'rotate',
            orientation,
            ...successText(`Rotated to ${orientation}`),
          };
        }
        case 'app-switcher':
          await interactor.appSwitcher();
          return { action: 'app-switcher', ...successText('Opened app switcher') };
        case 'clipboard':
          return handleClipboardCommand(interactor, positionals);
        case 'keyboard':
          return handleKeyboardCommand(device, positionals, context, runnerCtx);
        case 'settings':
          return handleSettingsCommand(device, interactor, positionals, context);
        case 'push':
          return handlePushCommand(device, positionals, context);
        case 'snapshot':
          return await handleSnapshotCommand(interactor, context);
        case 'read':
          return handleReadCommand(device, positionals, context);
        default:
          throw new AppError('INVALID_ARGS', `Unknown command: ${command}`);
      }
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
      url,
    });
    return { app, url, ...successText(`Opened: ${app}`) };
  }
  if (launchConsole && isDeepLinkTarget(app)) {
    throw new AppError('INVALID_ARGS', LAUNCH_CONSOLE_DIRECT_APP_ONLY_MESSAGE);
  }
  await interactor.open(app, {
    activity: context?.activity,
    appBundleId: context?.appBundleId,
    launchConsole,
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
  if (action !== 'status' && action !== 'get' && action !== 'dismiss') {
    throw new AppError('INVALID_ARGS', 'keyboard requires a subcommand: status, get, or dismiss');
  }
  if (positionals.length > 1) {
    throw new AppError('INVALID_ARGS', 'keyboard accepts at most one subcommand argument');
  }
  if (device.platform === 'android') {
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
  if (device.platform === 'ios') {
    if (action !== 'dismiss') {
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        'keyboard status/get is currently supported only on Android; use keyboard dismiss on iOS',
      );
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
  throw new AppError('UNSUPPORTED_OPERATION', 'keyboard is supported only on Android and iOS');
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
