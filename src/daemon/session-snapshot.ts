import type { SnapshotState } from '../utils/snapshot.ts';
import type { SessionState } from './types.ts';

export function setSessionSnapshot(session: SessionState, snapshot: SnapshotState): void {
  session.snapshot = snapshot;
  session.snapshotScopeSource = undefined;
}
