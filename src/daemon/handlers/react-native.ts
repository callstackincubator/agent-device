import { dispatchCommand } from '../../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../../core/capabilities.ts';
import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import {
  detectReactNativeOverlay,
  resolveReactNativeOverlayDismissTarget,
  type ReactNativeOverlayDismissTarget,
} from '../../commands/react-native/overlay.ts';
import { normalizeError } from '../../utils/errors.ts';
import { successText } from '../../utils/success-text.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import { errorResponse } from './response.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import { finalizeTouchInteraction, type InteractionHandlerParams } from './interaction-common.ts';
import { readSnapshotNodesReferenceFrame } from './interaction-touch-reference-frame.ts';

export async function handleReactNativeCommands(
  params: InteractionHandlerParams,
): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore } = params;
  if (req.command !== PUBLIC_COMMANDS.reactNative) return null;
  const parsed = parseReactNativeArgs(req.positionals ?? []);
  if (!parsed.ok) return parsed.response;

  const session = sessionStore.get(sessionName);
  if (!session) return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');
  if (!isCommandSupportedOnDevice(PUBLIC_COMMANDS.reactNative, session.device)) {
    return errorResponse(
      'UNSUPPORTED_OPERATION',
      'react-native dismiss-overlay is not supported on this device',
    );
  }

  try {
    const snapshot = await captureSnapshotForSession(
      session,
      req.flags,
      sessionStore,
      params.contextFromFlags,
      { interactiveOnly: true },
    );
    const target = resolveReactNativeOverlayDismissTarget(snapshot.nodes);
    if (!target) {
      return responseForMissingReactNativeOverlayTarget(snapshot);
    }
    return await dismissReactNativeOverlayTarget(params, session, snapshot, target);
  } catch (error) {
    return { ok: false, error: normalizeError(error) };
  }
}

function parseReactNativeArgs(
  positionals: string[],
): { ok: true } | { ok: false; response: DaemonResponse } {
  if (positionals.length === 1 && positionals[0] === 'dismiss-overlay') {
    return { ok: true };
  }
  return {
    ok: false,
    response: errorResponse('INVALID_ARGS', 'react-native supports only: dismiss-overlay'),
  };
}

function responseForMissingReactNativeOverlayTarget(snapshot: SnapshotState): DaemonResponse {
  const overlay = detectReactNativeOverlay(snapshot.nodes);
  if (!overlay.detected) {
    return {
      ok: true,
      data: {
        action: 'dismiss-overlay',
        detected: false,
        dismissed: false,
        ...successText('No React Native overlay detected'),
      },
    };
  }
  return errorResponse(
    'COMMAND_FAILED',
    'React Native overlay detected, but no safe dismiss target was found',
    {
      hint: 'Use screenshot --overlay-refs for visual evidence and report the overlay instead of pressing the warning body.',
    },
  );
}

async function dismissReactNativeOverlayTarget(
  params: InteractionHandlerParams,
  session: SessionState,
  snapshot: SnapshotState,
  target: ReactNativeOverlayDismissTarget,
): Promise<DaemonResponse> {
  const { req, sessionStore } = params;
  const actionStartedAt = Date.now();
  const data =
    (await dispatchCommand(
      session.device,
      'press',
      [String(target.point.x), String(target.point.y)],
      req.flags?.out,
      params.contextFromFlags(req.flags, session.appBundleId, session.trace?.outPath),
    )) ?? {};
  const actionFinishedAt = Date.now();
  const responseData = {
    ...readSnapshotNodesReferenceFrame(snapshot.nodes),
    ...data,
    action: 'dismiss-overlay',
    overlayAction: target.action,
    x: target.point.x,
    y: target.point.y,
    ...(target.ref ? { ref: target.ref } : {}),
    ...(target.label ? { label: target.label } : {}),
    ...(target.warning ? { warning: target.warning } : {}),
    dismissed: true,
    verified: false,
    verificationRequired: true,
    nextCommand: 'agent-device snapshot -i -c',
    ...successText(formatDismissMessage(target)),
  };
  return finalizeTouchInteraction({
    session,
    sessionStore,
    command: req.command,
    positionals: req.positionals ?? [],
    flags: req.flags,
    result: responseData,
    responseData,
    actionStartedAt,
    actionFinishedAt,
  });
}

function formatDismissMessage(target: ReactNativeOverlayDismissTarget): string {
  if (target.action === 'minimize') {
    return 'React Native RedBox minimize action sent; run snapshot -i before continuing';
  }
  return 'React Native overlay dismiss action sent; run snapshot -i before continuing';
}
