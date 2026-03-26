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
import { getInteractor, type RunnerContext } from '../utils/interactors.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { runMacOsReadTextAction } from '../platforms/ios/macos-helper.ts';
import { pushIosNotification } from '../platforms/ios/index.ts';
import type { SessionSurface } from './session-surface.ts';
import { isDeepLinkTarget } from './open-target.ts';
import { getClickButtonValidationError, resolveClickButton } from './click-button.ts';
import { parseTriggerAppEventArgs, resolveAppEventUrl } from './app-events.ts';
import type { RawSnapshotNode } from '../utils/snapshot.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../utils/diagnostics.ts';
import {
  requireIntInRange,
  clampIosSwipeDuration,
  shouldUseIosTapSeries,
  shouldUseIosDragSeries,
  computeDeterministicJitter,
  runRepeatedSeries,
} from './dispatch-series.ts';
import { readNotificationPayload } from './dispatch-payload.ts';

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

export async function dispatchCommand(
  device: DeviceInfo,
  command: string,
  positionals: string[],
  outPath?: string,
  context?: {
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
    count?: number;
    intervalMs?: number;
    holdMs?: number;
    jitterPx?: number;
    doubleTap?: boolean;
    clickButton?: 'primary' | 'secondary' | 'middle';
    backMode?: 'in-app' | 'system';
    pauseMs?: number;
    pattern?: 'one-way' | 'ping-pong';
    surface?: SessionSurface;
  },
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
        case 'open': {
          const app = positionals[0];
          const url = positionals[1];
          if (positionals.length > 2) {
            throw new AppError(
              'INVALID_ARGS',
              'open accepts at most two arguments: <app|url> [url]',
            );
          }
          if (!app) {
            await interactor.openDevice();
            return { app: null, message: 'Opened device' };
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
            return { app, url, message: `Opened: ${app}` };
          }
          await interactor.open(app, {
            activity: context?.activity,
            appBundleId: context?.appBundleId,
          });
          return { app, message: `Opened: ${app}` };
        }
        case 'close': {
          const app = positionals[0];
          if (!app) {
            return { closed: 'session', message: 'Closed session' };
          }
          await interactor.close(app);
          return { app, message: `Closed: ${app}` };
        }
        case 'press': {
          const [x, y] = positionals.map(Number);
          if (Number.isNaN(x) || Number.isNaN(y))
            throw new AppError('INVALID_ARGS', 'press requires x y');
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
              message: formatPressMessage({ x, y, button: clickButton }),
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
              message: formatPressMessage({ x, y }),
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
              interactionResult ??=
                (await interactor.longPress(targetX, targetY, holdMs)) ?? undefined;
            } else {
              interactionResult ??= (await interactor.tap(targetX, targetY)) ?? undefined;
            }
          });

          return {
            x,
            y,
            count,
            intervalMs,
            holdMs,
            jitterPx,
            doubleTap,
            ...interactionResult,
            message: formatPressMessage({ x, y }),
          };
        }
        case 'swipe': {
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
              message: formatSwipeMessage(count, pattern),
            };
          }

          await runRepeatedSeries(count, pauseMs, async (index) => {
            const reverse = pattern === 'ping-pong' && index % 2 === 1;
            if (reverse) await interactor.swipe(x2, y2, x1, y1, effectiveDurationMs);
            else await interactor.swipe(x1, y1, x2, y2, effectiveDurationMs);
          });

          return {
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
            message: formatSwipeMessage(count, pattern),
          };
        }
        case 'longpress': {
          const x = Number(positionals[0]);
          const y = Number(positionals[1]);
          const durationMs = positionals[2] ? Number(positionals[2]) : undefined;
          if (Number.isNaN(x) || Number.isNaN(y)) {
            throw new AppError('INVALID_ARGS', 'longpress requires x y [durationMs]');
          }
          await interactor.longPress(x, y, durationMs);
          return { x, y, durationMs, message: `Long pressed (${x}, ${y})` };
        }
        case 'focus': {
          const [x, y] = positionals.map(Number);
          if (Number.isNaN(x) || Number.isNaN(y))
            throw new AppError('INVALID_ARGS', 'focus requires x y');
          await interactor.focus(x, y);
          return { x, y, message: `Focused (${x}, ${y})` };
        }
        case 'type': {
          const text = positionals.join(' ');
          if (!text) throw new AppError('INVALID_ARGS', 'type requires text');
          await interactor.type(text);
          return { text, message: formatTextLengthMessage('Typed', text) };
        }
        case 'fill': {
          const x = Number(positionals[0]);
          const y = Number(positionals[1]);
          const text = positionals.slice(2).join(' ');
          if (Number.isNaN(x) || Number.isNaN(y) || !text) {
            throw new AppError('INVALID_ARGS', 'fill requires x y text');
          }
          await interactor.fill(x, y, text);
          return { x, y, text, message: formatTextLengthMessage('Filled', text) };
        }
        case 'scroll': {
          const direction = positionals[0];
          const amount = positionals[1] ? Number(positionals[1]) : undefined;
          if (!direction) throw new AppError('INVALID_ARGS', 'scroll requires direction');
          const interactionResult = await interactor.scroll(direction, amount);
          return {
            direction,
            amount,
            ...interactionResult,
            message:
              amount !== undefined ? `Scrolled ${direction} by ${amount}` : `Scrolled ${direction}`,
          };
        }
        case 'scrollintoview': {
          const text = positionals.join(' ').trim();
          if (!text) throw new AppError('INVALID_ARGS', 'scrollintoview requires text');
          const result = await interactor.scrollIntoView(text);
          if (result?.attempts) {
            return { text, attempts: result.attempts, message: `Scrolled into view: ${text}` };
          }
          return { text, message: `Scrolled into view: ${text}` };
        }
        case 'pinch': {
          if (device.platform === 'android') {
            throw new AppError(
              'UNSUPPORTED_OPERATION',
              'Android pinch is not supported in current adb backend; requires instrumentation-based backend.',
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
          return { scale, x, y, message: `Pinched to scale ${scale}` };
        }
        case 'trigger-app-event': {
          const { eventName, payload } = parseTriggerAppEventArgs(positionals);
          const eventUrl = resolveAppEventUrl(device.platform, eventName, payload);
          await interactor.open(eventUrl, { appBundleId: context?.appBundleId });
          return {
            event: eventName,
            eventUrl,
            transport: 'deep-link',
            message: `Triggered app event: ${eventName}`,
          };
        }
        case 'screenshot': {
          const positionalPath = positionals[0];
          const screenshotPath = positionalPath ?? outPath ?? `./screenshot-${Date.now()}.png`;
          await fs.mkdir(pathModule.dirname(screenshotPath), { recursive: true });
          await interactor.screenshot(screenshotPath, context?.appBundleId);
          return { path: screenshotPath, message: `Saved screenshot: ${screenshotPath}` };
        }
        case 'back': {
          await interactor.back(context?.backMode);
          return { action: 'back', mode: context?.backMode ?? 'in-app', message: 'Back' };
        }
        case 'home': {
          await interactor.home();
          return { action: 'home', message: 'Home' };
        }
        case 'app-switcher': {
          await interactor.appSwitcher();
          return { action: 'app-switcher', message: 'Opened app switcher' };
        }
        case 'clipboard': {
          const action = (positionals[0] ?? '').toLowerCase();
          if (action !== 'read' && action !== 'write') {
            throw new AppError('INVALID_ARGS', 'clipboard requires a subcommand: read or write');
          }
          if (action === 'read') {
            if (positionals.length !== 1) {
              throw new AppError(
                'INVALID_ARGS',
                'clipboard read does not accept additional arguments',
              );
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
            message: 'Clipboard updated',
          };
        }
        case 'keyboard': {
          if (device.platform !== 'android') {
            throw new AppError(
              'UNSUPPORTED_OPERATION',
              'keyboard is currently supported only on Android',
            );
          }
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
              message: result.dismissed ? 'Keyboard dismissed' : 'Keyboard already hidden',
            };
          }
          const state = await getAndroidKeyboardState(device);
          return {
            platform: 'android',
            action: 'status',
            visible: state.visible,
            inputType: state.inputType,
            type: state.type,
            message: state.visible ? 'Keyboard visible' : 'Keyboard hidden',
          };
        }
        case 'settings': {
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
            ? {
                setting,
                state,
                ...result,
                message: readResultMessage(result) ?? `Updated setting: ${setting}`,
              }
            : { setting, state, message: `Updated setting: ${setting}` };
        }
        case 'push': {
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
              message: `Pushed notification to ${target}`,
            };
          }
          const androidResult = await pushAndroidNotification(device, target, payload);
          return {
            platform: 'android',
            package: target,
            action: androidResult.action,
            extrasCount: androidResult.extrasCount,
            message: `Pushed notification to ${target}`,
          };
        }
        case 'snapshot': {
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
          };
        }
        case 'read': {
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
