import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
import { readAndroidTextAtPoint } from '../platforms/android/input-actions.ts';
import { runIosRunnerCommand } from '../platforms/ios/runner-client.ts';
import { runMacOsPressAction, runMacOsReadTextAction } from '../platforms/ios/macos-helper.ts';
import { rightClickLinux, middleClickLinux } from '../platforms/linux/input-actions.ts';
import { readLinuxTextAtPoint } from '../platforms/linux/snapshot.ts';
import { successText, withSuccessText } from '../utils/success-text.ts';
import { findMistargetedTypeRefToken } from '../utils/type-target-warning.ts';
import { parseScrollDirection } from './scroll-gesture.ts';
import {
  getClickButtonValidationError,
  resolveClickButton,
  type ClickButton,
} from './click-button.ts';
import {
  requireIntInRange,
  clampIosSwipeDuration,
  shouldUseIosTapSeries,
  shouldUseIosDragSeries,
  computeDeterministicJitter,
  runRepeatedSeries,
} from './dispatch-series.ts';
import type { DispatchContext } from './dispatch-context.ts';
import type { Interactor } from './interactor-types.ts';

export async function handleLongPressCommand(
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  const x = Number(positionals[0]);
  const y = Number(positionals[1]);
  const durationMs = positionals[2] ? Number(positionals[2]) : undefined;
  if (Number.isNaN(x) || Number.isNaN(y)) {
    throw new AppError('INVALID_ARGS', 'longpress requires x y [durationMs]');
  }
  await interactor.longPress(x, y, durationMs);
  return { x, y, durationMs, ...successText(`Long pressed (${x}, ${y})`) };
}

export async function handleFocusCommand(
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  const [x, y] = positionals.map(Number);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    throw new AppError('INVALID_ARGS', 'focus requires x y');
  }
  await interactor.focus(x, y);
  return { x, y, ...successText(`Focused (${x}, ${y})`) };
}

export async function handleTypeCommand(
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
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

export async function handleFillCommand(
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
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

export async function handlePressCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const { x, y } = readPoint(positionals, 'press requires x y');

  if (device.platform === 'macos' && context?.surface && context.surface !== 'app') {
    return await handleMacOsSurfacePress(x, y, context);
  }

  const clickButton = resolveClickButton(context);
  if (clickButton !== 'primary') {
    return await handleAlternateClick(device, x, y, clickButton, context);
  }

  const series = readPressSeriesOptions(context);
  validatePressSeriesOptions(series);

  if (shouldUseIosTapSeries(device, series.count, series.holdMs, series.jitterPx)) {
    return await runIosTapSeries(device, x, y, series, context);
  }

  return await runDirectPressSeries(interactor, x, y, series);
}

type Point = { x: number; y: number };

type PressSeriesOptions = {
  count: number;
  intervalMs: number;
  holdMs: number;
  jitterPx: number;
  doubleTap: boolean;
};

function readPoint(positionals: string[], errorMessage: string): Point {
  const [x, y] = positionals.map(Number);
  if (Number.isNaN(x) || Number.isNaN(y)) throw new AppError('INVALID_ARGS', errorMessage);
  return { x, y };
}

async function handleMacOsSurfacePress(
  x: number,
  y: number,
  context: DispatchContext,
): Promise<Record<string, unknown>> {
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

async function handleAlternateClick(
  device: DeviceInfo,
  x: number,
  y: number,
  button: ClickButton,
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  assertAlternateClickSupported(device, button, context);
  if (device.platform === 'linux') {
    return await runLinuxAlternateClick(x, y, button);
  }
  await runIosRunnerCommand(
    device,
    {
      command: 'mouseClick',
      x,
      y,
      button,
      appBundleId: context?.appBundleId,
    },
    runnerOptionsFromContext(context),
  );
  return {
    x,
    y,
    button,
    ...successText(formatPressMessage({ x, y, button })),
  };
}

function assertAlternateClickSupported(
  device: DeviceInfo,
  button: ClickButton,
  context: DispatchContext | undefined,
): void {
  const validationError = getClickButtonValidationError({
    commandLabel: 'click',
    platform: device.platform,
    button,
    count: context?.count,
    intervalMs: context?.intervalMs,
    holdMs: context?.holdMs,
    jitterPx: context?.jitterPx,
    doubleTap: context?.doubleTap,
  });
  if (validationError) {
    throw validationError;
  }
}

async function runLinuxAlternateClick(
  x: number,
  y: number,
  button: ClickButton,
): Promise<Record<string, unknown>> {
  if (button === 'secondary') {
    await rightClickLinux(x, y);
  } else {
    await middleClickLinux(x, y);
  }
  return {
    x,
    y,
    button,
    ...successText(formatPressMessage({ x, y, button })),
  };
}

function readPressSeriesOptions(context: DispatchContext | undefined): PressSeriesOptions {
  return {
    count: readContextInt(context?.count, 1, 'count', 1, 200),
    intervalMs: readContextInt(context?.intervalMs, 0, 'interval-ms', 0, 10_000),
    holdMs: readContextInt(context?.holdMs, 0, 'hold-ms', 0, 10_000),
    jitterPx: readContextInt(context?.jitterPx, 0, 'jitter-px', 0, 100),
    doubleTap: Boolean(context?.doubleTap),
  };
}

function readContextInt(
  value: number | undefined,
  fallback: number,
  label: string,
  min: number,
  max: number,
): number {
  return requireIntInRange(value === undefined ? fallback : value, label, min, max);
}

function validatePressSeriesOptions({ doubleTap, holdMs, jitterPx }: PressSeriesOptions): void {
  if (doubleTap && holdMs > 0) {
    throw new AppError('INVALID_ARGS', 'double-tap cannot be combined with hold-ms');
  }
  if (doubleTap && jitterPx > 0) {
    throw new AppError('INVALID_ARGS', 'double-tap cannot be combined with jitter-px');
  }
}

async function runIosTapSeries(
  device: DeviceInfo,
  x: number,
  y: number,
  series: PressSeriesOptions,
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const runnerResult = await runIosRunnerCommand(
    device,
    {
      command: 'tapSeries',
      x,
      y,
      count: series.count,
      intervalMs: series.intervalMs,
      doubleTap: series.doubleTap,
      appBundleId: context?.appBundleId,
    },
    runnerOptionsFromContext(context),
  );
  return {
    x,
    y,
    count: series.count,
    intervalMs: series.intervalMs,
    holdMs: series.holdMs,
    jitterPx: series.jitterPx,
    doubleTap: series.doubleTap,
    timingMode: 'runner-series',
    ...runnerResult,
    ...successText(formatPressMessage({ x, y })),
  };
}

async function runDirectPressSeries(
  interactor: Interactor,
  x: number,
  y: number,
  series: PressSeriesOptions,
): Promise<Record<string, unknown>> {
  let interactionResult: Record<string, unknown> | undefined;
  await runRepeatedSeries(series.count, series.intervalMs, async (index) => {
    const [dx, dy] = computeDeterministicJitter(index, series.jitterPx);
    const targetX = x + dx;
    const targetY = y + dy;
    if (series.doubleTap) {
      interactionResult ??= (await interactor.doubleTap(targetX, targetY)) ?? undefined;
      return;
    }
    if (series.holdMs > 0) {
      interactionResult ??=
        (await interactor.longPress(targetX, targetY, series.holdMs)) ?? undefined;
    } else {
      interactionResult ??= (await interactor.tap(targetX, targetY)) ?? undefined;
    }
  });

  return withSuccessText(
    {
      x,
      y,
      count: series.count,
      intervalMs: series.intervalMs,
      holdMs: series.holdMs,
      jitterPx: series.jitterPx,
      doubleTap: series.doubleTap,
      ...interactionResult,
    },
    formatPressMessage({ x, y }),
  );
}

function runnerOptionsFromContext(context: DispatchContext | undefined): {
  verbose?: boolean;
  logPath?: string;
  traceLogPath?: string;
  requestId?: string;
} {
  return {
    verbose: context?.verbose,
    logPath: context?.logPath,
    traceLogPath: context?.traceLogPath,
    requestId: context?.requestId,
  };
}

export async function handleSwipeCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
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

export async function handleScrollCommand(
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

export async function handlePinchCommand(
  device: DeviceInfo,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  if (device.platform === 'android') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'Android pinch is not supported in current adb backend; requires instrumentation-based backend.',
    );
  }
  if (device.target === 'tv') {
    throw new AppError('UNSUPPORTED_OPERATION', 'pinch is not supported on tvOS');
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

export async function handleReadCommand(
  device: DeviceInfo,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const [x, y] = positionals.map(Number);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    throw new AppError('INVALID_ARGS', 'read requires x y');
  }
  if (device.platform === 'android') {
    const text = await readAndroidTextAtPoint(device, x, y);
    return { action: 'read', text: text ?? '' };
  }
  if (device.platform === 'linux') {
    const text = await readLinuxTextAtPoint(x, y, context?.surface);
    return { action: 'read', text };
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

function findMistargetedTypeRef(positionals: string[]): string | null {
  return findMistargetedTypeRefToken(positionals[0]);
}

function formatPressMessage(params: { x: number; y: number; button?: ClickButton }): string {
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
