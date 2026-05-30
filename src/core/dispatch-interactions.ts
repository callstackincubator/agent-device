import { AppError } from '../utils/errors.ts';
import type { DeviceInfo } from '../utils/device.ts';
import { successText, withSuccessText } from '../utils/success-text.ts';
import { findMistargetedTypeRefToken } from '../utils/type-target-warning.ts';
import {
  buildSwipePresetGesturePlan,
  inferGestureReferenceFrame,
  parseScrollDirection,
  parseSwipePreset,
  type SwipePreset,
} from './scroll-gesture.ts';
import {
  getClickButtonValidationError,
  resolveClickButton,
  type ClickButton,
} from './click-button.ts';
import {
  captureScrollEdgeState,
  formatScrollEdgeMessage,
  runScrollEdgePasses,
  type ScrollEdge,
  type ScrollEdgeState,
} from '../utils/scroll-edge-state.ts';
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
  const { x, y } = readPoint(positionals, 'longpress requires x y [durationMs]', {
    hint: 'Direct platform longpress requires coordinates. In an open daemon session, use agent-device longpress @ref|selector [durationMs]; otherwise run snapshot -i -c, use the target rect center as x y, then retry longpress x y durationMs.',
  });
  const durationMs = positionals[2] ? Number(positionals[2]) : undefined;
  await interactor.longPress(x, y, durationMs);
  return { x, y, durationMs, ...successText(`Long pressed (${x}, ${y})`) };
}

export async function handleFocusCommand(
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  const { x, y } = readPoint(positionals, 'focus requires x y');
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
  if (context?.directElementSelector) {
    return await handleDirectElementSelectorFill(
      interactor,
      context.directElementSelector,
      positionals,
      context,
    );
  }

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

async function handleDirectElementSelectorFill(
  interactor: Interactor,
  selector: NonNullable<DispatchContext['directElementSelector']>,
  positionals: string[],
  context: DispatchContext,
): Promise<Record<string, unknown>> {
  if (!interactor.fillElementSelector) {
    throw new AppError('UNSUPPORTED_OPERATION', 'direct element selector fill is not supported');
  }
  const text = positionals.join(' ');
  if (!text) throw new AppError('INVALID_ARGS', 'fill requires text');
  const delayMs = requireIntInRange(context.delayMs ?? 0, 'delay-ms', 0, 10_000);
  const result = await interactor.fillElementSelector(selector, text, delayMs);
  return {
    selector: selector.raw,
    text,
    delayMs,
    ...(result ?? {}),
    ...successText(formatTextLengthMessage('Filled', text)),
  };
}

export async function handlePressCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  if (context?.directElementSelector && device.platform === 'ios') {
    return await handleDirectElementSelectorPress(interactor, context.directElementSelector);
  }

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

async function handleDirectElementSelectorPress(
  interactor: Interactor,
  selector: NonNullable<DispatchContext['directElementSelector']>,
): Promise<Record<string, unknown>> {
  if (!interactor.tapElementSelector) {
    throw new AppError('UNSUPPORTED_OPERATION', 'direct element selector tap is not supported');
  }
  const result = await interactor.tapElementSelector(selector);
  return {
    selector: selector.raw,
    ...(result ?? {}),
    ...successText(`Tapped ${selector.raw}`),
  };
}

type Point = { x: number; y: number };

type PressSeriesOptions = {
  count: number;
  intervalMs: number;
  holdMs: number;
  jitterPx: number;
  doubleTap: boolean;
};

function readPoint(
  positionals: string[],
  errorMessage: string,
  details?: Record<string, unknown>,
): Point {
  const x = Number(positionals[0]);
  const y = Number(positionals[1]);
  if (Number.isNaN(x) || Number.isNaN(y)) {
    throw new AppError('INVALID_ARGS', errorMessage, details);
  }
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
  const { runMacOsPressAction } = await import('../platforms/ios/macos-helper.ts');
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
  const { runIosRunnerCommand } = await import('../platforms/ios/runner-client.ts');
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
    const { rightClickLinux } = await import('../platforms/linux/input-actions.ts');
    await rightClickLinux(x, y);
  } else {
    const { middleClickLinux } = await import('../platforms/linux/input-actions.ts');
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
  const { runIosRunnerCommand } = await import('../platforms/ios/runner-client.ts');
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
  return await runSwipeCoordinates({
    device,
    interactor,
    context,
    x1,
    y1,
    x2,
    y2,
    requestedDurationMs,
  });
}

export async function handleSwipePresetCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const preset = parseSwipePreset(positionals[0]);
  const requestedDurationMs = positionals[1] ? Number(positionals[1]) : 300;
  const snapshot = await interactor.snapshot({ appBundleId: context?.appBundleId, compact: true });
  const frame = inferGestureReferenceFrame(snapshot.nodes ?? []);
  if (!frame) {
    throw new AppError('COMMAND_FAILED', 'Cannot infer viewport for gesture swipe preset');
  }
  const plan = buildSwipePresetGesturePlan(preset, frame, { platform: device.platform });
  return await runSwipeCoordinates({
    device,
    interactor,
    context,
    x1: plan.x1,
    y1: plan.y1,
    x2: plan.x2,
    y2: plan.y2,
    requestedDurationMs,
    preset,
  });
}

// fallow-ignore-next-line complexity
async function runSwipeCoordinates(params: {
  device: DeviceInfo;
  interactor: Interactor;
  context: DispatchContext | undefined;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  requestedDurationMs: number;
  preset?: SwipePreset;
}): Promise<Record<string, unknown>> {
  const { device, interactor, context, x1, y1, x2, y2, requestedDurationMs, preset } = params;
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
    const { runIosRunnerCommand } = await import('../platforms/ios/runner-client.ts');
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
      ...(preset ? { preset } : {}),
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
      ...(preset ? { preset } : {}),
      durationMs,
      effectiveDurationMs,
      timingMode: device.platform === 'ios' ? 'safe-normalized' : 'direct',
      count,
      pauseMs,
      pattern,
    },
    preset ? `Swiped ${preset}` : formatSwipeMessage(count, pattern),
  );
}

export async function handlePanCommand(
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  const x = Number(positionals[0]);
  const y = Number(positionals[1]);
  const dx = Number(positionals[2]);
  const dy = Number(positionals[3]);
  if ([x, y, dx, dy].some((value) => !Number.isFinite(value))) {
    throw new AppError('INVALID_ARGS', 'gesture pan requires x y dx dy [durationMs]');
  }
  const requestedDurationMs = positionals[4] ? Number(positionals[4]) : 500;
  const durationMs = requireIntInRange(requestedDurationMs, 'durationMs', 16, 10_000);
  const x2 = x + dx;
  const y2 = y + dy;
  await interactor.pan(x, y, x2, y2, durationMs);
  return {
    x,
    y,
    dx,
    dy,
    x2,
    y2,
    durationMs,
    ...successText(`Panned (${x}, ${y}) by (${dx}, ${dy})`),
  };
}

export async function handleFlingCommand(
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  const direction = parseGestureDirection(positionals[0], 'fling direction');
  const x = Number(positionals[1]);
  const y = Number(positionals[2]);
  if (![x, y].every(Number.isFinite)) {
    throw new AppError(
      'INVALID_ARGS',
      'gesture fling requires direction x y [distance] [durationMs]',
    );
  }
  const distanceInput = positionals[3] ? Number(positionals[3]) : 180;
  const distance = requireFinitePositiveNumber(distanceInput, 'distance');
  const requestedDurationMs = positionals[4] ? Number(positionals[4]) : 50;
  const durationMs = requireIntInRange(requestedDurationMs, 'durationMs', 16, 1_000);
  const { x2, y2 } = pointOffsetByDirection(x, y, direction, distance);
  await interactor.fling(x, y, x2, y2, durationMs);
  return {
    direction,
    x,
    y,
    x2,
    y2,
    distance,
    durationMs,
    ...successText(`Flung ${direction}`),
  };
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
  const target = parseScrollTarget(directionInput);
  let interactionResult: Record<string, unknown> | void = {};
  let completedPasses = 0;

  if (target.edge) {
    const edge = target.edge;
    const edgeResult = await runScrollEdgePasses({
      edge,
      captureState: async (scope) =>
        await captureVerifiedScrollEdgeState(interactor, context, edge, scope),
      scroll: async () => await interactor.scroll(target.direction, { amount, pixels }),
    });
    interactionResult = edgeResult.result ?? {};
    completedPasses = edgeResult.passes;
  } else {
    interactionResult = await interactor.scroll(target.direction, { amount, pixels });
    completedPasses = 1;
  }

  return withSuccessText(
    {
      direction: target.direction,
      ...(target.edge
        ? {
            edge: target.edge,
            passes: completedPasses,
          }
        : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(pixels !== undefined ? { pixels } : {}),
      ...interactionResult,
    },
    formatScrollEdgeMessage(target.direction, target.edge, completedPasses, amount, pixels),
  );
}

async function captureVerifiedScrollEdgeState(
  interactor: Interactor,
  context: DispatchContext | undefined,
  edge: ScrollEdge,
  scope?: string,
): Promise<ScrollEdgeState> {
  if (typeof interactor.snapshot !== 'function') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `scroll ${edge} requires snapshot support to verify hidden content before scrolling`,
    );
  }
  const snapshot = interactor.snapshot;
  return await captureScrollEdgeState({
    edge,
    scope,
    captureNodes: async (snapshotScope) =>
      (
        await snapshot({
          appBundleId: context?.appBundleId,
          compact: true,
          scope: snapshotScope,
        })
      ).nodes ?? [],
  });
}

function parseScrollTarget(input: string): {
  direction: ReturnType<typeof parseScrollDirection>;
  edge?: 'top' | 'bottom';
} {
  if (input === 'bottom') return { direction: 'down', edge: 'bottom' };
  if (input === 'top') return { direction: 'up', edge: 'top' };
  return { direction: parseScrollDirection(input) };
}

export async function handlePinchCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  if (device.target === 'tv') {
    throw new AppError('UNSUPPORTED_OPERATION', 'gesture pinch is not supported on tvOS');
  }
  if (device.platform === 'macos' && context?.surface && context.surface !== 'app') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'gesture pinch is only supported in macOS app sessions. Re-open the target app without --surface desktop|menubar|frontmost-app first.',
    );
  }
  const scale = Number(positionals[0]);
  const x = positionals[1] ? Number(positionals[1]) : undefined;
  const y = positionals[2] ? Number(positionals[2]) : undefined;
  if (Number.isNaN(scale) || scale <= 0) {
    throw new AppError('INVALID_ARGS', 'gesture pinch requires scale > 0');
  }
  const interactionResult = await interactor.pinch(scale, x, y);
  return { scale, x, y, ...interactionResult, ...successText(`Pinched to scale ${scale}`) };
}

export async function handleRotateGestureCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  if (device.target === 'tv') {
    throw new AppError('UNSUPPORTED_OPERATION', 'gesture rotate is not supported on tvOS');
  }
  if (device.platform === 'macos') {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'gesture rotate is not supported on macOS; XCTest rotation gestures are available only for iOS app sessions.',
    );
  }

  const { degrees, x, y, velocity } = parseRotateGestureParams(positionals);

  const interactionResult = await interactor.rotateGesture(degrees, x, y, velocity);
  return {
    degrees,
    ...(x !== undefined && y !== undefined ? { x, y } : {}),
    velocity,
    ...interactionResult,
    ...successText(`Rotated gesture ${degrees} degrees`),
  };
}

export async function handleTransformGestureCommand(
  device: DeviceInfo,
  interactor: Interactor,
  positionals: string[],
): Promise<Record<string, unknown>> {
  if (device.target === 'tv') {
    throw new AppError('UNSUPPORTED_OPERATION', 'gesture transform is not supported on tvOS');
  }
  const supportedIosSimulator = device.platform === 'ios' && device.kind === 'simulator';
  if (device.platform !== 'android' && !supportedIosSimulator) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'gesture transform is currently supported on Android and iOS simulators',
    );
  }

  const params = parseTransformGestureParams(positionals);
  const interactionResult = await interactor.transformGesture(params);
  return {
    ...params,
    ...interactionResult,
    ...successText(
      `Requested transform gesture by (${params.dx}, ${params.dy}), scale ${params.scale}, rotate ${params.degrees} degrees`,
    ),
  };
}

type GestureDirection = 'up' | 'down' | 'left' | 'right';

type RotateGestureParams = {
  degrees: number;
  x?: number;
  y?: number;
  velocity: number;
};

type TransformGestureParams = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  scale: number;
  degrees: number;
  durationMs?: number;
};

function parseRotateGestureParams(positionals: string[]): RotateGestureParams {
  const degrees = Number(positionals[0]);
  if (!Number.isFinite(degrees)) {
    throw new AppError('INVALID_ARGS', 'gesture rotate requires degrees [x] [y] [velocity]');
  }

  const center = parseOptionalGestureCenter(positionals[1], positionals[2]);
  const velocity = Number(positionals[3] ?? (degrees >= 0 ? 1 : -1));
  if (!Number.isFinite(velocity) || velocity === 0) {
    throw new AppError('INVALID_ARGS', 'gesture rotate velocity must be a non-zero number');
  }

  return { degrees, ...center, velocity: Math.abs(velocity) * (degrees >= 0 ? 1 : -1) };
}

function parseTransformGestureParams(positionals: string[]): TransformGestureParams {
  const x = Number(positionals[0]);
  const y = Number(positionals[1]);
  const dx = Number(positionals[2]);
  const dy = Number(positionals[3]);
  const scale = Number(positionals[4]);
  const degrees = Number(positionals[5]);
  if (![x, y, dx, dy, scale, degrees].every(Number.isFinite)) {
    throw new AppError(
      'INVALID_ARGS',
      'gesture transform requires x y dx dy scale degrees [durationMs]',
    );
  }
  if (scale <= 0) {
    throw new AppError('INVALID_ARGS', 'gesture transform scale must be > 0');
  }
  const durationMs =
    positionals[6] === undefined
      ? undefined
      : requireIntInRange(Number(positionals[6]), 'durationMs', 16, 10_000);
  return { x, y, dx, dy, scale, degrees, durationMs };
}

function parseOptionalGestureCenter(
  xInput: string | undefined,
  yInput: string | undefined,
): Pick<RotateGestureParams, 'x' | 'y'> {
  if (xInput === undefined && yInput === undefined) return {};
  if (xInput === undefined || yInput === undefined) {
    throw new AppError('INVALID_ARGS', 'gesture rotate center requires both x and y');
  }

  const x = Number(xInput);
  const y = Number(yInput);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new AppError('INVALID_ARGS', 'gesture rotate center requires finite x and y');
  }
  return { x, y };
}

function parseGestureDirection(input: string | undefined, field: string): GestureDirection {
  if (input === 'up' || input === 'down' || input === 'left' || input === 'right') {
    return input;
  }
  throw new AppError('INVALID_ARGS', `${field} must be up, down, left, or right`);
}

function requireFinitePositiveNumber(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError('INVALID_ARGS', `${field} must be a positive number`);
  }
  return value;
}

function pointOffsetByDirection(
  x: number,
  y: number,
  direction: GestureDirection,
  distance: number,
): { x2: number; y2: number } {
  switch (direction) {
    case 'up':
      return { x2: x, y2: y - distance };
    case 'down':
      return { x2: x, y2: y + distance };
    case 'left':
      return { x2: x - distance, y2: y };
    case 'right':
      return { x2: x + distance, y2: y };
  }
}

export async function handleReadCommand(
  device: DeviceInfo,
  positionals: string[],
  context: DispatchContext | undefined,
): Promise<Record<string, unknown>> {
  const { x, y } = readPoint(positionals, 'read requires x y');
  if (device.platform === 'android') {
    const { readAndroidTextAtPoint } = await import('../platforms/android/input-actions.ts');
    const text = await readAndroidTextAtPoint(device, x, y);
    return { action: 'read', text: text ?? '' };
  }
  if (device.platform === 'linux') {
    const { readLinuxTextAtPoint } = await import('../platforms/linux/snapshot.ts');
    const text = await readLinuxTextAtPoint(x, y, context?.surface);
    return { action: 'read', text };
  }
  if (device.platform === 'macos' && context?.surface && context.surface !== 'app') {
    const { runMacOsReadTextAction } = await import('../platforms/ios/macos-helper.ts');
    const result = await runMacOsReadTextAction(x, y, {
      bundleId: context.appBundleId,
      surface: context.surface,
    });
    return { action: 'read', text: result.text };
  }
  // macOS app sessions run through the XCUITest runner; only desktop/menubar surfaces use the helper.
  const { runIosRunnerCommand } = await import('../platforms/ios/runner-client.ts');
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
