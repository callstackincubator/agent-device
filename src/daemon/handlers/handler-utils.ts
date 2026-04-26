import type { CommandFlags } from '../../core/dispatch.ts';
import { SessionStore } from '../session-store.ts';
import type { DaemonRequest, SessionState } from '../types.ts';

/**
 * Record a session action if a session is active. No-op when session is undefined.
 */
export function recordSessionAction(
  sessionStore: SessionStore,
  session: SessionState | undefined,
  req: DaemonRequest,
  command: string,
  result: Record<string, unknown> | undefined,
): void {
  if (!session) return;
  sessionStore.recordAction(session, {
    command,
    positionals: req.positionals ?? [],
    flags: (req.flags ?? {}) as CommandFlags,
    result: result ?? {},
  });
}

/**
 * Flag keys inherited from a parent request (batch/replay) into child step flags.
 * Shared between batch and replay so the inheritance rules stay in sync.
 */
const INHERITED_PARENT_FLAG_KEYS: ReadonlyArray<keyof CommandFlags> = [
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'verbose',
  'out',
];

/**
 * Merge parent flag values into child flags for keys that are undefined in the child.
 */
export function mergeParentFlags(
  parentFlags: CommandFlags | undefined,
  childFlags: CommandFlags,
): CommandFlags {
  const parentRecord = (parentFlags ?? {}) as Record<string, unknown>;
  const childRecord = childFlags as Record<string, unknown>;
  for (const key of INHERITED_PARENT_FLAG_KEYS) {
    if (childRecord[key] === undefined && parentRecord[key] !== undefined) {
      childRecord[key] = parentRecord[key];
    }
  }
  return childFlags;
}
