import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import {
  buttonTag,
  getClickButtonValidationError,
  resolveClickButton,
} from '../../core/click-button.ts';
import type { FillCommandResult, PressCommandResult } from '../../commands/index.ts';
import { asAppError, normalizeError } from '../../utils/errors.ts';
import type { DaemonResponse } from '../types.ts';
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
  formatPressTargetLabel,
  interactionResultExtra,
  parseFillTarget,
  parsePressTarget,
  stripAtPrefix,
} from './interaction-touch-targets.ts';

export async function handleTouchInteractionCommands(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
    refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
  },
): Promise<DaemonResponse | null> {
  switch (params.req.command) {
    case 'press':
    case 'click':
      return await dispatchPressViaRuntime(params);
    case 'fill':
      return await dispatchFillViaRuntime(params);
    default:
      return null;
  }
}

async function dispatchPressViaRuntime(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
    refSnapshotFlagGuardResponse: RefSnapshotFlagGuardResponse;
  },
): Promise<DaemonResponse> {
  const { req, sessionName, sessionStore } = params;
  const session = sessionStore.get(sessionName);
  const commandLabel = req.command === 'click' ? 'click' : 'press';
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');

  const unsupportedSurfaceResponse = unsupportedMacOsDesktopSurfaceInteraction(
    session,
    commandLabel,
  );
  if (unsupportedSurfaceResponse) return unsupportedSurfaceResponse;
  if (!isCommandSupportedOnDevice('press', session.device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'press is not supported on this device');
  }

  const clickButton = resolveClickButton(req.flags);
  const resultButtonTag = buttonTag(clickButton);
  if (clickButton !== 'primary') {
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

  const parsedTarget = parsePressTarget(req.positionals ?? [], commandLabel);
  if (!parsedTarget.ok) return parsedTarget.response;
  if (parsedTarget.target.kind === 'ref') {
    const invalidRefFlagsResponse = params.refSnapshotFlagGuardResponse('press', req.flags);
    if (invalidRefFlagsResponse) return invalidRefFlagsResponse;
  }

  return await dispatchRuntimeInteraction(params, {
    run: async (runtime) => {
      const options = {
        session: sessionName,
        requestId: req.meta?.requestId,
        button: clickButton,
        count: req.flags?.count,
        intervalMs: req.flags?.intervalMs,
        holdMs: req.flags?.holdMs,
        jitterPx: req.flags?.jitterPx,
        doubleTap: req.flags?.doubleTap,
      };
      return commandLabel === 'click'
        ? await runtime.interactions.click(parsedTarget.target, options)
        : await runtime.interactions.press(parsedTarget.target, options);
    },
    afterRun: async (result) => {
      await assertAndroidPressStayedInApp(
        session,
        formatPressTargetLabel(parsedTarget.target, result),
      );
    },
    buildPayloads: async (result) => {
      const referenceFrame =
        result.kind === 'point'
          ? await resolveDirectTouchReferenceFrameSafely({
              session,
              flags: req.flags,
              sessionStore,
              contextFromFlags: params.contextFromFlags,
              captureSnapshotForSession: params.captureSnapshotForSession,
            })
          : readSnapshotNodesReferenceFrame(session.snapshot?.nodes ?? []);
      const responseData = buildTouchVisualizationResult({
        data: result.backendResult,
        fallbackX: result.point.x,
        fallbackY: result.point.y,
        referenceFrame,
        extra: {
          ...interactionResultExtra(result),
          ...resultButtonTag,
        },
      });
      return { result: responseData, responseData };
    },
  });
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

async function dispatchRuntimeInteraction<TResult extends PressCommandResult | FillCommandResult>(
  params: InteractionHandlerParams & {
    captureSnapshotForSession: CaptureSnapshotForSession;
  },
  options: {
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
    });
  } catch (error) {
    const appError = asAppError(error);
    if (isAndroidEscapeError(appError)) throw appError;
    return appErrorResponse(error);
  }
}

function appErrorResponse(error: unknown): DaemonResponse {
  return { ok: false, error: normalizeError(error) };
}
