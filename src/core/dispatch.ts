import { promises as fs } from 'node:fs';
import pathModule from 'node:path';
import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
import {
  dismissAndroidKeyboard,
  getAndroidKeyboardState,
  pushAndroidNotification,
  readAndroidTextAtPoint,
  snapshotAndroid,
} from '../platforms/android/index.ts';
import { getInteractor, type Interactor, type RunnerContext } from './interactors.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { runMacOsPressAction, runMacOsReadTextAction } from '../platforms/ios/macos-helper.ts';
import { pushIosNotification } from '../platforms/ios/index.ts';
import type { SessionSurface } from './session-surface.ts';
import { isDeepLinkTarget } from './open-target.ts';
import { getClickButtonValidationError, resolveClickButton } from './click-button.ts';
import { parseTriggerAppEventArgs, resolveAppEventUrl } from './app-events.ts';
import type { RawSnapshotNode } from '../utils/snapshot.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../utils/diagnostics.ts';
import { successText, withSuccessText } from '../utils/success-text.ts';
import { parseScrollDirection } from './scroll-gesture.ts';
import {
  requireIntInRange,
  clampIosSwipeDuration,
  shouldUseIosTapSeries,
  shouldUseIosDragSeries,
  computeDeterministicJitter,
  runRepeatedSeries,
} from './dispatch-series.ts';
import { readNotificationPayload } from './dispatch-payload.ts';
import { parseDeviceRotation } from './device-rotation.ts';

export { resolveTargetDevice } from './dispatch-resolve.ts';
export { shouldUseIosTapSeries, shouldUseIosDragSeries };

export type BatchStep = {
  command: string;
  positionals?: string[];
  flags?: Partial<CommandFlags>;
  runtime?: unknown;
};

export type CommandFlags = Omit<CliFlags, 'json' | 'help' | 'version' | 'batchSteps'> & {
  batchSteps?: BatchStep[];
};

type DispatchContext = {
  requestId?: string;
  appBundleId?: string;
  activity?: string;
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  snapshotInteractiveOnly?: boolean;
  snapshotCompact?: boolean;
  snapshotDepth?: number;
  snapshotScope?: string;
  snapshotRaw?: boolean;
  screenshotFullscreen?: boolean;
  count?: number;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pixels?: number;
  doubleTap?: boolean;
  clickButton?: 'primary' | 'secondary' | 'middle';
  backMode?: 'in-app' | 'system';
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  maxScrolls?: number;
  surface?: SessionSurface;
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
          return handlePressCommand(device, interactor, positionals, context, runnerCtx);
        case 'swipe':
          return handleSwipeCommand(device, interactor, positionals, context, runnerCtx);
        case 'longpress': {
          const x = Number(positionals[0]);
          const y = Number(positionals[1]);
          const durationMs = positionals[2] ? Number(positionals[2]) : undefined;
          if (Number.isNaN(x) || Number.isNaN(y)) {
            throw new AppError('INVALID_ARGS', 'longpress requires x y [durationMs]');
          }
          await interactor.longPress(x, y, durationMs);
          return { x, y, durationMs, ...successText(`Long pressed (${x}, ${y})`) };
        }
        case 'focus': {
          const [x, y] = positionals.map(Number);
          if (Number.isNaN(x) || Number.isNaN(y))
            throw new AppError('INVALID_ARGS', 'focus requires x y');
          await interactor.focus(x, y);
          return { x, y, ...successText(`Focused (${x}, ${y})`) };
        }
        case 'type': {
          const mistargetedRef = findMistargetedTypeRef(positionals);
          if (mistargetedRef) {
            throw new AppError(
              'INVALID_ARGS',
              `type does not accept a target ref like "${mistargetedRef}"`,
              {
                hint: `Use fill ${mistargetedRef} "text" to target that field, or press ${mistargetedRef} then type "text" to append.`,
              },
            );
          }
          const text = positionals.join(' ');
          if (!text) throw new AppError('INVALID_ARGS', 'type requires text');
          const delayMs = requireIntInRange(context?.delayMs ?? 0, 'delay-ms', 0, 10_000);
          await interactor.type(text, delayMs);
          return { text, delayMs, ...successText(formatTextLengthMessage('Typed', text)) };
        }
        case 'fill': {
          const x = Number(positionals[0]);
          const y = Number(positionals[1]);
          const text = positionals.slice(2).join(' ');
          if (Number.isNaN(x) || Number.isNaN(y) || !text) {
            throw new AppError('INVALID_ARGS', 'fill requires x y text');
          }
          const delayMs = requireIntInRange(context?.delayMs ?? 0, 'delay-ms', 0, 10_000);
          await interactor.fill(x, y, text, delayMs);
          return { x, y, text, delayMs, ...successText(formatTextLengthMessage('Filled', text)) };
        }
        case 'scroll':
          return handleScrollCommand(interactor, positionals, context);
        case 'scrollintoview': {
          const text = positionals.join(' ').trim();
          if (!text) throw new AppError('INVALID_ARGS', 'scrollintoview requires text');
          const result = await interactor.scrollIntoView(text, {
            maxScrolls: context?.maxScrolls,
          });
          if (typeof result?.attempts === 'number') {
            return {
              text,
              attempts: result.attempts,
              ...successText(`Scrolled into view: ${text}`),
            };
          }
          return { text, ...successText(`Scrolled into view: ${text}`) };
        }
        case 'pinch':
          return handlePinchCommand(device, positionals, context, runnerCtx);
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
          await interactor.screenshot(screenshotPath, {
            appBundleId: context?.appBundleId,
            fullscreen: context?.screenshotFullscreen,
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
          return handleKeyboardCommand(device, interactor, positionals, context, runnerCtx);
        case 'settings':
          return handleSettingsCommand(device, interactor, positionals, context);
        case 'push':
          return handlePushCommand(device, positionals, context);
        case 'snapshot':
          return handleSnapshotCommand(device, positionals, context, runnerCtx);
        case 'read':
          return handleReadCommand(device, positionals, context, runnerCtx);
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

async function handleOpenCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const app = positionals[0];
  const url = positionals[1];
  if (positionals.length > 2) {
    throw new AppError('INVALID_ARGS', 'open accepts at most two arguments: <app|url> [url]');
  }
  if (!app) {
    await interactor.openDevice();
    return { app: null, ...successText('Opened device') };
  }
  if (url !== undefined) {
    if (device.platform === 'android') {
      throw new AppError(
        'INVALID_ARGS',
        'open <app> <url> is supported only on Apple platforms',
      );
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
    await interactor.open(app, {
      activity: context?.activity,
      appBundleId: context?.appBundleId,
      url,
    });
    return { app, url, ...successText(`Opened: ${app}`) };
  }
  await interactor.open(app, {
    activity: context?.activity,
    appBundleId: context?.appBundleId,
  });
  return { app, ...successText(`Opened: ${app}`) };
}

async function handlePressCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
  _runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  const [x, y] = positionals.map(Number);
  if (Number.isNaN(x) || Number.isNaN(y))
    throw new AppError('INVALID_ARGS', 'press requires x y');

  if (device.platform === 'macos' && context?.surface && context.surface !== 'app') {
    const clickButton = resolveClickButton(context);
    if (clickButton !== 'primary') {
      throw new AppError(
        'UNSUPPORTED_OPERATION',
        `${clickButton} click is not supported on macOS ${context.surface} sessions.`,
      );
    }
    await runMacOsPressAction(x, y, {
      bundleId: context.appBundleId,
      surface: context.surface,
    });
    return { x, y, ...successText(formatPressMessage({ x, y })) };
  }

  const clickButton = resolveClickButton(context);
  if (clickButton !== 'primary') {
    const validationError = getClickButtonValidationError({
      commandLabel: 'click',
      platform: device.platform,
      button: clickButton,
      count: context?.count,
      intervalMs: context?.intervalMs,
      holdMs: context?.holdMs,
      jitterPx: context?.jitterPx,
      doubleTap: context?.doubleTap,
    });
    if (validationError) {
      throw validationError;
    }
    await runIosRunnerCommand(
      device,
      {
        command: 'mouseClick',
        x,
        y,
        button: clickButton,
        appBundleId: context?.appBundleId,
      },
      {
        verbose: context?.verbose,
        logPath: context?.logPath,
        traceLogPath: context?.traceLogPath,
        requestId: context?.requestId,
      },
    );
    return {
      x,
      y,
      button: clickButton,
      ...successText(formatPressMessage({ x, y, button: clickButton })),
    };
  }

  const count = requireIntInRange(context?.count ?? 1, 'count', 1, 200);
  const intervalMs = requireIntInRange(context?.intervalMs ?? 0, 'interval-ms', 0, 10_000);
  const holdMs = requireIntInRange(context?.holdMs ?? 0, 'hold-ms', 0, 10_000);
  const jitterPx = requireIntInRange(context?.jitterPx ?? 0, 'jitter-px', 0, 100);
  const doubleTap = context?.doubleTap === true;

  if (doubleTap && holdMs > 0) {
    throw new AppError('INVALID_ARGS', 'double-tap cannot be combined with hold-ms');
  }
  if (doubleTap && jitterPx > 0) {
    throw new AppError('INVALID_ARGS', 'double-tap cannot be combined with jitter-px');
  }

  if (shouldUseIosTapSeries(device, count, holdMs, jitterPx)) {
    const runnerResult = await runIosRunnerCommand(
      device,
      {
        command: 'tapSeries',
        x,
        y,
        count,
        intervalMs,
        doubleTap,
        appBundleId: context?.appBundleId,
      },
      {
        verbose: context?.verbose,
        logPath: context?.logPath,
        traceLogPath: context?.traceLogPath,
        requestId: context?.requestId,
      },
    );
    return {
      x,
      y,
      count,
      intervalMs,
      holdMs,
      jitterPx,
      doubleTap,
      timingMode: 'runner-series',
      ...runnerResult,
      ...successText(formatPressMessage({ x, y })),
    };
  }

  let interactionResult: Record<string, unknown> | undefined;
  await runRepeatedSeries(count, intervalMs, async (index) => {
    const [dx, dy] = computeDeterministicJitter(index, jitterPx);
    const targetX = x + dx;
    const targetY = y + dy;
    if (doubleTap) {
      interactionResult ??= (await interactor.doubleTap(targetX, targetY)) ?? undefined;
      return;
    }
    if (holdMs > 0) {
      interactionResult ??= (await interactor.longPress(targetX, targetY, holdMs)) ?? undefined;
    } else {
      interactionResult ??= (await interactor.tap(targetX, targetY)) ?? undefined;
    }
  });

  return withSuccessText(
    {
      x,
      y,
      count,
      intervalMs,
      holdMs,
      jitterPx,
      doubleTap,
      ...interactionResult,
    },
    formatPressMessage({ x, y }),
  );
}

async function handleSwipeCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
  _runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  const x1 = Number(positionals[0]);
  const y1 = Number(positionals[1]);
  const x2 = Number(positionals[2]);
  const y2 = Number(positionals[3]);
  if ([x1, y1, x2, y2].some(Number.isNaN)) {
    throw new AppError('INVALID_ARGS', 'swipe requires x1 y1 x2 y2 [durationMs]');
  }

  const requestedDurationMs = positionals[4] ? Number(positionals[4]) : 250;
  const durationMs = requireIntInRange(requestedDurationMs, 'durationMs', 16, 10_000);
  const effectiveDurationMs =
    device.platform === 'ios' ? clampIosSwipeDuration(durationMs) : durationMs;
  const count = requireIntInRange(context?.count ?? 1, 'count', 1, 200);
  const pauseMs = requireIntInRange(context?.pauseMs ?? 0, 'pause-ms', 0, 10_000);
  const pattern = context?.pattern ?? 'one-way';
  if (pattern !== 'one-way' && pattern !== 'ping-pong') {
    throw new AppError('INVALID_ARGS', `Invalid pattern: ${pattern}`);
  }

  if (shouldUseIosDragSeries(device, count)) {
    const runnerResult = await runIosRunnerCommand(
      device,
      {
        command: 'dragSeries',
        x: x1,
        y: y1,
        x2,
        y2,
        durationMs: effectiveDurationMs,
        count,
        pauseMs,
        pattern,
        appBundleId: context?.appBundleId,
      },
      {
        verbose: context?.verbose,
        logPath: context?.logPath,
        traceLogPath: context?.traceLogPath,
        requestId: context?.requestId,
      },
    );
    return {
      x1,
      y1,
      x2,
      y2,
      durationMs,
      effectiveDurationMs,
      timingMode: 'runner-series',
      count,
      pauseMs,
      pattern,
      ...runnerResult,
      ...successText(formatSwipeMessage(count, pattern)),
    };
  }

  await runRepeatedSeries(count, pauseMs, async (index) => {
    const reverse = pattern === 'ping-pong' && index % 2 === 1;
    if (reverse) await interactor.swipe(x2, y2, x1, y1, effectiveDurationMs);
    else await interactor.swipe(x1, y1, x2, y2, effectiveDurationMs);
  });

  return withSuccessText(
    {
      x1,
      y1,
      x2,
      y2,
      durationMs,
      effectiveDurationMs,
      timingMode: device.platform === 'ios' ? 'safe-normalized' : 'direct',
      count,
      pauseMs,
      pattern,
    },
    formatSwipeMessage(count, pattern),
  );
}

async function handleScrollCommand(
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const directionInput = positionals[0];
  const amount = positionals[1] ? Number(positionals[1]) : undefined;
  const pixels = context?.pixels;
  if (!directionInput) throw new AppError('INVALID_ARGS', 'scroll requires direction');
  if (amount !== undefined && !Number.isFinite(amount)) {
    throw new AppError('INVALID_ARGS', 'scroll amount must be a number');
  }
  if (amount !== undefined && pixels !== undefined) {
    throw new AppError(
      'INVALID_ARGS',
      'scroll accepts either a relative amount or --pixels, not both',
    );
  }
  const direction = parseScrollDirection(directionInput);
  const interactionResult = await interactor.scroll(direction, { amount, pixels });
  return withSuccessText(
    {
      direction,
      ...(amount !== undefined ? { amount } : {}),
      ...(pixels !== undefined ? { pixels } : {}),
      ...interactionResult,
    },
    pixels !== undefined
      ? `Scrolled ${direction} by ${pixels}px`
      : amount !== undefined
        ? `Scrolled ${direction} by ${amount}`
        : `Scrolled ${direction}`,
  );
}

async function handlePinchCommand(
  device: DeviceInfo,
  positionals: string[],
  context: DispatchContext | undefined,
  _runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  if (device.platform === 'android') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'Android pinch is not supported in current adb backend; requires instrumentation-based backend.',
    );
  }
  if (device.platform === 'macos' && context?.surface && context.surface !== 'app') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'pinch is only supported in macOS app sessions. Re-open the target app without --surface desktop|menubar|frontmost-app first.',
    );
  }
  const scale = Number(positionals[0]);
  const x = positionals[1] ? Number(positionals[1]) : undefined;
  const y = positionals[2] ? Number(positionals[2]) : undefined;
  if (Number.isNaN(scale) || scale <= 0) {
    throw new AppError('INVALID_ARGS', 'pinch requires scale > 0');
  }
  await runIosRunnerCommand(
    device,
    { command: 'pinch', scale, x, y, appBundleId: context?.appBundleId },
    {
      verbose: context?.verbose,
      logPath: context?.logPath,
      traceLogPath: context?.traceLogPath,
      requestId: context?.requestId,
    },
  );
  return { scale, x, y, ...successText(`Pinched to scale ${scale}`) };
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
    throw new AppError(
      'INVALID_ARGS',
      'clipboard write requires text (use "" to clear clipboard)',
    );
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
  _interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
  runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  const action = (positionals[0] ?? 'status').toLowerCase();
  if (action !== 'status' && action !== 'get' && action !== 'dismiss') {
    throw new AppError(
      'INVALID_ARGS',
      'keyboard requires a subcommand: status, get, or dismiss',
    );
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
      };
    }
    const state = await getAndroidKeyboardState(device);
    return {
      platform: 'android',
      action: 'status',
      visible: state.visible,
      inputType: state.inputType,
      type: state.type,
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
  const [setting, state, target, mode, appBundleId] = positionals;
  const permissionOptions =
    setting === 'permission'
      ? {
          permissionTarget: target,
          permissionMode: mode,
        }
      : undefined;
  emitDiagnostic({
    level: 'debug',
    phase: 'settings_apply',
    data: {
      setting,
      state,
      target,
      mode,
      platform: device.platform,
    },
  });
  const result = await interactor.setSetting(
    setting,
    state,
    appBundleId ?? context?.appBundleId,
    permissionOptions,
  );
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
    throw new AppError(
      'INVALID_ARGS',
      'push requires <bundle|package> <payload.json|inline-json>',
    );
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
  device: DeviceInfo,
  _positionals: string[],
  context: DispatchContext | undefined,
  _runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  if (device.platform !== 'android') {
    const result = (await withDiagnosticTimer(
      'snapshot_capture',
      async () =>
        await runIosRunnerCommand(
          device,
          {
            command: 'snapshot',
            appBundleId: context?.appBundleId,
            interactiveOnly: context?.snapshotInteractiveOnly,
            compact: context?.snapshotCompact,
            depth: context?.snapshotDepth,
            scope: context?.snapshotScope,
            raw: context?.snapshotRaw,
          },
          {
            verbose: context?.verbose,
            logPath: context?.logPath,
            traceLogPath: context?.traceLogPath,
            requestId: context?.requestId,
          },
        ),
      {
        backend: 'xctest',
      },
    )) as { nodes?: RawSnapshotNode[]; truncated?: boolean };
    const nodes = result.nodes ?? [];
    if (nodes.length === 0 && device.kind === 'simulator') {
      throw new AppError(
        'COMMAND_FAILED',
        'XCTest snapshot returned 0 nodes on iOS simulator.',
      );
    }
    return { nodes, truncated: result.truncated ?? false, backend: 'xctest' };
  }
  const androidResult = await withDiagnosticTimer(
    'snapshot_capture',
    async () =>
      await snapshotAndroid(device, {
        interactiveOnly: context?.snapshotInteractiveOnly,
        compact: context?.snapshotCompact,
        depth: context?.snapshotDepth,
        scope: context?.snapshotScope,
        raw: context?.snapshotRaw,
      }),
    {
      backend: 'android',
    },
  );
  return {
    nodes: androidResult.nodes ?? [],
    truncated: androidResult.truncated ?? false,
    backend: 'android',
    analysis: androidResult.analysis,
  };
}

async function handleReadCommand(
  device: DeviceInfo,
  positionals: string[],
  context: DispatchContext | undefined,
  _runnerCtx: RunnerContext,
): Promise<Record<string, unknown>> {
  const [x, y] = positionals.map(Number);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    throw new AppError('INVALID_ARGS', 'read requires x y');
  }
  if (device.platform === 'android') {
    const text = await readAndroidTextAtPoint(device, x, y);
    return { action: 'read', text: text ?? '' };
  }
  if (device.platform === 'macos' && context?.surface && context.surface !== 'app') {
    const result = await runMacOsReadTextAction(x, y, {
      bundleId: context.appBundleId,
      surface: context.surface,
    });
    return { action: 'read', text: result.text };
  }
  // macOS app sessions run through the XCUITest runner; only desktop/menubar surfaces use the helper.
  const result = await runIosRunnerCommand(
    device,
    {
      command: 'readText',
      x,
      y,
      appBundleId: context?.appBundleId,
    },
    {
      verbose: context?.verbose,
      logPath: context?.logPath,
      traceLogPath: context?.traceLogPath,
      requestId: context?.requestId,
    },
  );
  const text =
    typeof result.text === 'string'
      ? result.text
      : typeof result.message === 'string'
        ? result.message
        : '';
  return { action: 'read', text };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findMistargetedTypeRef(positionals: string[]): string | null {
  const first = positionals[0]?.trim();
  if (!first || !first.startsWith('@') || first.length < 3) {
    return null;
  }
  const body = first.slice(1);
  if (/^[A-Za-z_-]*\d[\w-]*$/i.test(body) || /^(?:ref|node|element|el)[\w-]*$/i.test(body)) {
    return first;
  }
  return null;
}

function formatPressMessage(params: {
  x: number;
  y: number;
  button?: 'primary' | 'secondary' | 'middle';
}): string {
  if (params.button && params.button !== 'primary') {
    return `Clicked ${params.button} (${params.x}, ${params.y})`;
  }
  return `Tapped (${params.x}, ${params.y})`;
}

function formatSwipeMessage(count: number, pattern: 'one-way' | 'ping-pong'): string {
  if (count <= 1) return 'Swiped';
  return pattern === 'ping-pong' ? `Swiped ${count} times (ping-pong)` : `Swiped ${count} times`;
}

function formatTextLengthMessage(action: 'Typed' | 'Filled', text: string): string {
  return `${action} ${Array.from(text).length} chars`;
}

function readResultMessage(result: Record<string, unknown>): string | undefined {
  return typeof result.message === 'string' && result.message.length > 0
    ? result.message
    : undefined;
}
