import type { CommandFlags } from '../../core/dispatch.ts';
import type { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import type { ContextFromFlags } from './interaction-common.ts';
import { captureSnapshot } from './snapshot-capture.ts';
import { setSessionSnapshot } from '../session-snapshot.ts';

export type CaptureSnapshotForSession = (
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean; androidFreshnessMode?: 'ref-refresh' },
) => Promise<SnapshotState>;

export async function captureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean; androidFreshnessMode?: 'ref-refresh' },
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
    androidFreshnessMode: options.androidFreshnessMode,
  });
  setSessionSnapshot(session, snapshot);
  sessionStore.set(session.name, session);
  return snapshot;
}
