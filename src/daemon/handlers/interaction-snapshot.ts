import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import type { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import type { ContextFromFlags } from './interaction-common.ts';
import { captureSnapshot } from './snapshot-capture.ts';

export async function captureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
  dispatch: typeof dispatchCommand = dispatchCommand,
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
    dispatchSnapshotCommand: dispatch,
    device: session.device,
    session,
    req: {
      token: '',
      session: session.name,
      command: 'snapshot',
      positionals: [],
      flags: effectiveFlags,
    },
    logPath: dispatchContext.logPath ?? '',
  });
  session.snapshot = snapshot;
  sessionStore.set(session.name, session);
  return session.snapshot;
}
