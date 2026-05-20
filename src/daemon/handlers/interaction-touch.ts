import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import {
  buttonTag,
  getClickButtonValidationError,
  resolveClickButton,
} from '../../core/click-button.ts';
import type {
  FillCommandResult,
  InteractionTarget,
  LongPressCommandResult,
  PressCommandResult,
} from '../../commands/index.ts';
import { asAppError, normalizeError } from '../../utils/errors.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import {
  buildTouchVisualizationResult,
  finalizeTouchInteraction,
  type InteractionHandlerParams,
} from './interaction-common.ts';
import type { CaptureSnapshotForSession } from './interaction-snapshot.ts';
import type { RefSnapshotFlagGuardResponse } from './interaction-flags.ts';
import {
  readSnapshotNodesReferenceFrame,
  resolveDirectTouchReferenceFrameSafely,
} from './interaction-touch-reference-frame.ts';
import { unsupportedMacOsDesktopSurfaceInteraction } from './interaction-touch-policy.ts';
import { errorResponse } from './response.ts';
import {
  assertAndroidPressStayedInApp,
  isAndroidEscapeError,
} from './interaction-android-escape.ts';
import { createInteractionRuntime } from './interaction-runtime.ts';
import {
  formatTouchTargetLabel,
  interactionResultExtra,
  parseFillTarget,
  parseLongPressTarget,
  parseTouchTarget,
  stripAtPrefix,
} from './interaction-touch-targets.ts';
import { getActiveAndroidSnapshotFreshness } from '../android-snapshot-freshness.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import {
  isDirectIosSelectorFallbackError,
  readSimpleIosSelectorTarget,
  type DirectIosSelectorTarget,
} from '../direct-ios-selector.ts';

export async function handleTouchInteractionCommands(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
    refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
  },
): Promise<DaemonResponse | null> {
  switch (params.req.command) {
    case 'press':
      return await dispatchTargetedTouchViaRuntime(params, 'press');
    case 'click':
      return await dispatchTargetedTouchViaRuntime(params, 'click');
    case 'longpress':
      return await dispatchTargetedTouchViaRuntime(params, 'longpress');
    case 'fill':
      return await dispatchFillViaRuntime(params);
    default:
      return null;
  }
}

// fallow-ignore-next-line complexity
async function dispatchTargetedTouchViaRuntime(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
    refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
  },
  command: TargetedTouchCommand,
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');

  const commandLabel = command === 'click' ? 'click' : command;
  const capabilityCommand = command === 'longpress' ? 'longpress' : 'press';
  const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(
    session,
    commandLabel,
  );
  if (unsupportedSurfaceResponse) return unsupportedSurfaceResponse;
  if (!isCommandSupportedOnDevice(capabilityCommand, session.device)) {
    return errorResponse(
      'UNSUPPORTED_OPERATION',
      `${capabilityCommand} is not supported on this device`,
    );
  }

  const clickButton = resolveClickButton(req.flags);
  const resultButtonTag = buttonTag(clickButton);
  if (command !== 'longpress' && clickButton !== 'primary') {
    const validationError = getClickButtonValidationError({
      commandLabel,
      platform: session.device.platform,
      button: clickButton,
      count: req.flags?.count,
      intervalMs: req.flags?.intervalMs,
      holdMs: req.flags?.holdMs,
      jitterPx: req.flags?.jitterPx,
      doubleTap: req.flags?.doubleTap,
    });
    if (validationError) {
      return errorResponse(validationError.code, validationError.message, validationError.details);
    }
  }

  const parsedTarget =
    command === 'longpress'
      ? parseLongPressTarget(req.positionals ?? [])
      : parseTouchTarget(req.positionals ?? [], commandLabel);
  if (!parsedTarget.ok) return parsedTarget.response;
  let androidFreshnessBaseline: SessionState['snapshot'];
  if (parsedTarget.target.kind === 'ref') {
    const invalidRefFlagsResponse = params.refSnapshotFlagGuardResponse(
      command === 'longpress' ? 'longpress' : 'press',
      req.flags,
    );
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
    androidFreshnessBaseline = await refreshAndroidRefSnapshotIfFreshnessActive(params, session);
  }
  const directSelector = readDirectIosSelectorTapTarget({
    session,
    commandLabel,
    target: parsedTarget.target,
    flags: req.flags,
  });
  if (directSelector) {
    const directResponse = await dispatchDirectIosSelectorTap(params, session, directSelector);
    if (directResponse) return directResponse;
  }
  const durationMs = command === 'longpress' ? parsedTarget.durationMs : undefined;

  return await dispatchRuntimeInteraction(params, {
    androidFreshnessBaseline,
    run: async (runtime) =>
      await runTargetedTouchInteraction({
        runtime,
        command,
        target: parsedTarget.target,
        sessionName,
        requestId: req.meta?.requestId,
        clickButton,
        flags: req.flags,
        durationMs,
      }),
    afterRun: async (result) => {
      await assertAndroidPressStayedInApp(
        session,
        formatTouchTargetLabel(parsedTarget.target, result),
      );
    },
    buildPayloads: async (result) => {
      const durationMs = readLongPressResultDuration(result);
      const responseData = await buildTargetedTouchResponseData({
        params,
        session,
        result,
        extra:
          command === 'longpress'
            ? {
                ...(durationMs !== undefined ? { durationMs } : {}),
                gesture: 'longpress',
              }
            : resultButtonTag,
      });
      return { result: responseData, responseData };
    },
  });
}

type TargetedTouchCommand = 'press' | 'click' | 'longpress';
type TargetedTouchResult = PressCommandResult | LongPressCommandResult;

async function runTargetedTouchInteraction(params: {
  runtime: ReturnType<typeof createInteractionRuntime>;
  command: TargetedTouchCommand;
  target: InteractionTarget;
  sessionName: string;
  requestId: string | undefined;
  clickButton: ReturnType<typeof resolveClickButton>;
  flags: CommandFlags | undefined;
  durationMs?: number;
}): Promise<TargetedTouchResult> {
  const { runtime, command, target, sessionName, requestId, flags } = params;
  if (command === 'longpress') {
    return await runtime.interactions.longPress(target, {
      session: sessionName,
      requestId,
      durationMs: params.durationMs,
    });
  }

  const options = {
    session: sessionName,
    requestId,
    button: params.clickButton,
    count: flags?.count,
    intervalMs: flags?.intervalMs,
    holdMs: flags?.holdMs,
    jitterPx: flags?.jitterPx,
    doubleTap: flags?.doubleTap,
  };
  return command === 'click'
    ? await runtime.interactions.click(target, options)
    : await runtime.interactions.press(target, options);
}

async function buildTargetedTouchResponseData(params: {
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
  };
  session: SessionState;
  result: TargetedTouchResult;
  extra: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const { params: handlerParams, session, result, extra } = params;
  const referenceFrame =
    result.kind === 'point'
      ? await resolveDirectTouchReferenceFrameSafely({
          session,
          flags: handlerParams.req.flags,
          sessionStore: handlerParams.sessionStore,
          contextFromFlags: handlerParams.contextFromFlags,
          captureSnapshotForSession: handlerParams.captureSnapshotForSession,
        })
      : readSnapshotNodesReferenceFrame(session.snapshot?.nodes ?? []);
  return buildTouchVisualizationResult({
    data: result.backendResult,
    fallbackX: result.point.x,
    fallbackY: result.point.y,
    referenceFrame,
    extra: {
      ...interactionResultExtra(result),
      ...extra,
    },
  });
}

function readLongPressResultDuration(result: TargetedTouchResult): number | undefined {
  return 'durationMs' in result ? result.durationMs : undefined;
}

function readDirectIosSelectorTapTarget(params: {
  session: SessionState;
  commandLabel: string;
  target: InteractionTarget;
  flags: CommandFlags | undefined;
}): DirectIosSelectorTarget | null {
  const { session, commandLabel, target, flags } = params;
  if (commandLabel !== 'click') return null;
  if (target.kind !== 'selector') return null;
  if (hasNonDefaultClickOptions(flags)) return null;
  return readSimpleIosSelectorTarget({ session, selectorExpression: target.selector });
}

function hasNonDefaultClickOptions(flags: CommandFlags | undefined): boolean {
  return Boolean(
    flags?.count !== undefined ||
    flags?.intervalMs !== undefined ||
    flags?.holdMs !== undefined ||
    flags?.jitterPx !== undefined ||
    flags?.doubleTap !== undefined ||
    (flags?.clickButton !== undefined && flags.clickButton !== 'primary'),
  );
}

async function dispatchDirectIosSelectorTap(
  params: InteractionHandlerParams,
  session: SessionState,
  selector: DirectIosSelectorTarget,
): Promise<DaemonResponse | null> {
  const actionStartedAt = Date.now();
  try {
    const data =
      (await dispatchCommand(session.device, 'press', [], params.req.flags?.out, {
        ...params.contextFromFlags(params.req.flags, session.appBundleId, session.trace?.outPath),
        directElementSelector: selector,
        surface: session.surface,
      })) ?? {};
    const actionFinishedAt = Date.now();
    const point = readPointFromDirectSelectorTapResult(data);
    const responseData = buildTouchVisualizationResult({
      data,
      fallbackX: point.x,
      fallbackY: point.y,
      referenceFrame: readReferenceFrameFromDirectSelectorTapResult(data),
      extra: {
        selector: selector.raw,
      },
    });
    return finalizeTouchInteraction({
      session,
      sessionStore: params.sessionStore,
      command: params.req.command,
      positionals: params.req.positionals ?? [],
      flags: params.req.flags,
      result: responseData,
      responseData,
      actionStartedAt,
      actionFinishedAt,
    });
  } catch (error) {
    if (!isDirectIosSelectorFallbackError(error)) {
      return { ok: false, error: normalizeError(error) };
    }
    emitDiagnostic({
      level: 'debug',
      phase: 'ios_direct_selector_tap_fallback',
      data: {
        selector: selector.raw,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return null;
  }
}

function readPointFromDirectSelectorTapResult(data: Record<string, unknown>): {
  x: number;
  y: number;
} {
  const x = typeof data.x === 'number' ? data.x : undefined;
  const y = typeof data.y === 'number' ? data.y : undefined;
  if (x !== undefined && y !== undefined) {
    return { x, y };
  }
  return { x: 0, y: 0 };
}

function readReferenceFrameFromDirectSelectorTapResult(
  data: Record<string, unknown>,
): { referenceWidth: number; referenceHeight: number } | undefined {
  return typeof data.referenceWidth === 'number' && typeof data.referenceHeight === 'number'
    ? { referenceWidth: data.referenceWidth, referenceHeight: data.referenceHeight }
    : undefined;
}

async function dispatchFillViaRuntime(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
    refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
  },
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  if (session) {
    const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(session, 'fill');
    if (unsupportedSurfaceResponse) return unsupportedSurfaceResponse;
  }
  if (session && !isCommandSupportedOnDevice('fill', session.device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'fill is not supported on this device');
  }
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');

  const parsedTarget = parseFillTarget(req.positionals ?? []);
  if (!parsedTarget.ok) return parsedTarget.response;
  if (parsedTarget.target.kind === 'ref') {
    const invalidRefFlagsResponse = params.refSnapshotFlagGuardResponse('fill', req.flags);
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
    await refreshAndroidRefSnapshotIfFreshnessActive(params, session);
  }

  return await dispatchRuntimeInteraction(params, {
    run: async (runtime) =>
      await runtime.interactions.fill(parsedTarget.target, parsedTarget.text, {
        session: sessionName,
        requestId: req.meta?.requestId,
        delayMs: req.flags?.delayMs,
      }),
    buildPayloads: (result) => {
      const referenceFrame =
        result.kind === 'point'
          ? undefined
          : readSnapshotNodesReferenceFrame(session.snapshot?.nodes ?? []);
      const recordedResult = buildTouchVisualizationResult({
        data: result.backendResult,
        fallbackX: result.point.x,
        fallbackY: result.point.y,
        referenceFrame,
        extra: {
          ...interactionResultExtra(result),
          text: parsedTarget.text,
        },
      });
      if (result.warning) recordedResult.warning = result.warning;

      const responseData =
        result.kind === 'ref'
          ? {
              ...(result.backendResult ?? {
                ref: stripAtPrefix(result.target?.kind === 'ref' ? result.target.ref : undefined),
                x: result.point.x,
                y: result.point.y,
              }),
            }
          : recordedResult;
      if (result.warning) responseData.warning = result.warning;
      return { result: recordedResult, responseData };
    },
  });
}

async function dispatchRuntimeInteraction<
  TResult extends PressCommandResult | FillCommandResult | LongPressCommandResult,
>(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
  },
  options: {
    androidFreshnessBaseline?: SessionState['snapshot'];
    run(runtime: ReturnType<typeof createInteractionRuntime>): Promise<TResult>;
    afterRun?(result: TResult): Promise<void>;
    buildPayloads(
      result: TResult,
    ):
      | { result: Record<string, unknown>; responseData: Record<string, unknown> }
      | Promise<{ result: Record<string, unknown>; responseData: Record<string, unknown> }>;
  },
): Promise<DaemonResponse> {
  const session = params.sessionStore.get(params.sessionName);
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');
  const runtime = createInteractionRuntime(params);
  const actionStartedAt = Date.now();
  try {
    const runtimeResult = await options.run(runtime);
    await options.afterRun?.(runtimeResult);
    const actionFinishedAt = Date.now();
    const { result, responseData } = await options.buildPayloads(runtimeResult);
    return finalizeTouchInteraction({
      session,
      sessionStore: params.sessionStore,
      command: params.req.command,
      positionals: params.req.positionals ?? [],
      flags: params.req.flags,
      result,
      responseData,
      actionStartedAt,
      actionFinishedAt,
      androidFreshnessBaseline: options.androidFreshnessBaseline,
    });
  } catch (error) {
    const appError = asAppError(error);
    if (isAndroidEscapeError(appError)) throw appError;
    return appErrorResponse(error);
  }
}

async function refreshAndroidRefSnapshotIfFreshnessActive(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
  },
  session: SessionState,
): Promise<SessionState['snapshot']> {
  if (!getActiveAndroidSnapshotFreshness(session)) return undefined;
  const freshnessBaseline =
    session.snapshot?.comparisonSafe === true ? session.snapshot : undefined;
  try {
    await params.captureSnapshotForSession(
      session,
      params.req.flags,
      params.sessionStore,
      params.contextFromFlags,
      { interactiveOnly: true, androidFreshnessMode: 'ref-refresh' },
    );
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'android_ref_snapshot_refresh_failed',
      data: {
        command: params.req.command,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
  return freshnessBaseline;
}

function appErrorResponse(error: unknown): DaemonResponse {
  return { ok: false, error: normalizeError(error) };
}
