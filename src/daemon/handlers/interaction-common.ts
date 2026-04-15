import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import type { DaemonCommandContext } from '../context.ts';
import { recordTouchVisualizationEvent } from '../recording-gestures.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { successText } from '../../utils/success-text.ts';
import {
  isNavigationSensitiveAction,
  markAndroidSnapshotFreshness,
} from '../android-snapshot-freshness.ts';

export type ContextFromFlags = (
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
) => DaemonCommandContext;

export type InteractionHandlerParams = {
  req: DaemonRequest;
  sessionName: string;
  logPath?: string;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
};

export function buildTouchVisualizationResult(params: {
  data: Record<string, unknown> | undefined;
  fallbackX: number;
  fallbackY: number;
  referenceFrame?: { referenceWidth: number; referenceHeight: number };
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const { data, fallbackX, fallbackY, referenceFrame, extra } = params;
  const message =
    buildTouchMessage(extra, fallbackX, fallbackY) ??
    (typeof data?.message === 'string' ? data.message : undefined);
  return {
    x: fallbackX,
    y: fallbackY,
    ...(referenceFrame ?? {}),
    ...(extra ?? {}),
    ...(data ?? {}),
    ...successText(message),
  };
}

function buildTouchMessage(
  extra: Record<string, unknown> | undefined,
  x: number,
  y: number,
): string | undefined {
  const ref = typeof extra?.ref === 'string' ? extra.ref : undefined;
  const button = typeof extra?.button === 'string' ? extra.button : undefined;
  if (typeof extra?.text === 'string') {
    return `Filled ${Array.from(extra.text).length} chars`;
  }
  if (ref) {
    if (button && button !== 'primary') {
      return `Clicked ${button} @${ref} (${x}, ${y})`;
    }
    return `Tapped @${ref} (${x}, ${y})`;
  }
  return undefined;
}

export async function dispatchRecordedTouchInteraction(params: {
  session: SessionState;
  sessionStore: SessionStore;
  requestCommand: string;
  requestPositionals: string[];
  flags: CommandFlags | undefined;
  contextFromFlags: ContextFromFlags;
  interactionCommand: string;
  interactionPositionals: string[];
  outPath: string | undefined;
  afterDispatch?: (data: Record<string, unknown> | undefined) => void | Promise<void>;
  buildPayloads: (data: Record<string, unknown> | undefined) =>
    | {
        result: Record<string, unknown>;
        responseData?: Record<string, unknown>;
      }
    | Promise<{
        result: Record<string, unknown>;
        responseData?: Record<string, unknown>;
      }>;
}): Promise<DaemonResponse> {
  const {
    session,
    sessionStore,
    requestCommand,
    requestPositionals,
    flags,
    contextFromFlags,
    interactionCommand,
    interactionPositionals,
    outPath,
    afterDispatch,
    buildPayloads,
  } = params;
  const interaction = await dispatchInteractionCommand({
    session,
    flags,
    contextFromFlags,
    command: interactionCommand,
    positionals: interactionPositionals,
    outPath,
  });
  await afterDispatch?.(interaction.data);
  const { result, responseData = result } = await buildPayloads(interaction.data);
  return finalizeTouchInteraction({
    session,
    sessionStore,
    command: requestCommand,
    positionals: requestPositionals,
    flags,
    result,
    responseData,
    actionStartedAt: interaction.actionStartedAt,
    actionFinishedAt: interaction.actionFinishedAt,
  });
}

async function dispatchInteractionCommand(params: {
  session: SessionState;
  flags: CommandFlags | undefined;
  contextFromFlags: ContextFromFlags;
  command: string;
  positionals: string[];
  outPath: string | undefined;
}): Promise<{
  data: Record<string, unknown> | undefined;
  actionStartedAt: number;
  actionFinishedAt: number;
}> {
  const { session, flags, contextFromFlags, command, positionals, outPath } = params;
  const actionStartedAt = Date.now();
  const dispatchContext = {
    ...contextFromFlags(flags, session.appBundleId, session.trace?.outPath),
  };
  const rawData = await dispatchCommand(
    session.device,
    command,
    positionals,
    outPath,
    dispatchContext,
  );
  const actionFinishedAt = Date.now();
  const data = rawData && typeof rawData === 'object' ? rawData : undefined;
  return { data, actionStartedAt, actionFinishedAt };
}

export function finalizeTouchInteraction(params: {
  session: SessionState;
  sessionStore: SessionStore;
  command: string;
  positionals: string[];
  flags: CommandFlags | undefined;
  result: Record<string, unknown>;
  responseData: Record<string, unknown>;
  actionStartedAt: number;
  actionFinishedAt: number;
}): DaemonResponse {
  const {
    session,
    sessionStore,
    command,
    positionals,
    flags,
    result,
    responseData,
    actionStartedAt,
    actionFinishedAt,
  } = params;
  sessionStore.recordAction(session, {
    command,
    positionals,
    flags: flags ?? {},
    result,
  });
  if (isNavigationSensitiveAction(command)) {
    markAndroidSnapshotFreshness(session, command);
  }
  recordTouchVisualizationEvent(
    session,
    command,
    positionals,
    result,
    (flags ?? {}) as Record<string, unknown>,
    actionStartedAt,
    actionFinishedAt,
  );
  return { ok: true, data: responseData };
}
