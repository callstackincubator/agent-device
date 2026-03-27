import type { CommandFlags } from '../../core/dispatch.ts';
import { getAndroidScreenSize } from '../../platforms/android/index.ts';
import type { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import type { SnapshotNode, SnapshotState } from '../../utils/snapshot.ts';
import { getSnapshotReferenceFrame } from '../touch-reference-frame.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { ContextFromFlags } from './interaction-common.ts';
import { captureSnapshot } from './snapshot-capture.ts';

export type CaptureSnapshotForSession = (
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
) => Promise<SnapshotState>;

export async function captureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
): Promise<SnapshotState> {
  const effectiveFlags = {
    ...(flags ?? {}),
    snapshotInteractiveOnly: options.interactiveOnly,
    snapshotCompact: options.interactiveOnly,
  };
  const dispatchContext = contextFromFlags(
    effectiveFlags,
    session.appBundleId,
    session.trace?.outPath,
  );
  const { snapshot } = await captureSnapshot({
    device: session.device,
    session,
    flags: effectiveFlags,
    outPath: effectiveFlags.out,
    logPath: dispatchContext.logPath ?? '',
  });
  session.snapshot = snapshot;
  sessionStore.set(session.name, session);
  return session.snapshot;
}

export async function resolveDirectTouchReferenceFrame(params: {
  session: SessionState;
  flags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
}): Promise<{ referenceWidth: number; referenceHeight: number } | undefined> {
  const { session, flags, sessionStore, contextFromFlags, captureSnapshotForSession } = params;
  if (!session.recording) {
    return undefined;
  }
  if (session.recording.touchReferenceFrame) {
    return session.recording.touchReferenceFrame;
  }

  if (session.device.platform === 'android') {
    const size = await getAndroidScreenSize(session.device);
    const referenceFrame = {
      referenceWidth: size.width,
      referenceHeight: size.height,
    };
    if (session.recording) {
      session.recording.touchReferenceFrame = referenceFrame;
    }
    return referenceFrame;
  }

  const snapshotFrame = getSnapshotReferenceFrame(session.snapshot);
  if (snapshotFrame) {
    if (session.recording) {
      session.recording.touchReferenceFrame = snapshotFrame;
    }
    return snapshotFrame;
  }

  if (!session.recording) {
    return undefined;
  }

  const snapshot = await captureSnapshotForSession(session, flags, sessionStore, contextFromFlags, {
    interactiveOnly: true,
  });
  const referenceFrame = getSnapshotReferenceFrame(snapshot);
  if (referenceFrame && session.recording) {
    session.recording.touchReferenceFrame = referenceFrame;
  }
  return referenceFrame;
}

export async function resolveDirectTouchReferenceFrameSafely(params: {
  session: SessionState;
  flags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  captureSnapshotForSession: CaptureSnapshotForSession;
}): Promise<{ referenceWidth: number; referenceHeight: number } | undefined> {
  try {
    return await resolveDirectTouchReferenceFrame(params);
  } catch (error) {
    emitDiagnostic({
      level: 'warn',
      phase: 'touch_reference_frame_resolve_failed',
      data: {
        platform: params.session.device.platform,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    return undefined;
  }
}

export function readSnapshotNodesReferenceFrame(
  nodes: SnapshotNode[],
): { referenceWidth: number; referenceHeight: number } | undefined {
  return getSnapshotReferenceFrame({
    nodes,
    createdAt: 0,
  });
}
