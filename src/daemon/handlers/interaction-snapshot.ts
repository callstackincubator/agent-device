import { dispatchCommand, type CommandFlags } from '../../core/dispatch.ts';
import { attachRefs, type RawSnapshotNode } from '../../utils/snapshot.ts';
import { pruneGroupNodes } from '../snapshot-processing.ts';
import type { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import type { ContextFromFlags } from './interaction-common.ts';

export async function captureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: ContextFromFlags,
  options: { interactiveOnly: boolean },
  dispatch: typeof dispatchCommand = dispatchCommand,
): Promise<SnapshotState> {
  const data = (await dispatch(session.device, 'snapshot', [], flags?.out, {
    ...contextFromFlags(
      {
        ...(flags ?? {}),
        snapshotInteractiveOnly: options.interactiveOnly,
        snapshotCompact: options.interactiveOnly,
      },
      session.appBundleId,
      session.trace?.outPath,
    ),
  })) as {
    nodes?: RawSnapshotNode[];
    truncated?: boolean;
    backend?: 'xctest' | 'android';
  };
  const rawNodes = data?.nodes ?? [];
  const nodes = attachRefs(flags?.snapshotRaw ? rawNodes : pruneGroupNodes(rawNodes));
  session.snapshot = {
    nodes,
    truncated: data?.truncated,
    createdAt: Date.now(),
    backend: data?.backend,
  };
  sessionStore.set(session.name, session);
  return session.snapshot;
}
