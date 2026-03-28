import type { CommandFlags } from '../../core/dispatch.ts';
import { contextFromFlags, type DaemonCommandContext } from '../context.ts';
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
 * Build a DaemonCommandContext from a log path and request, using the session's
 * app bundle ID and trace output path when available.
 */
export function buildHandlerContext(
  logPath: string,
  req: DaemonRequest,
  session: SessionState | undefined,
): DaemonCommandContext {
  return contextFromFlags(logPath, req.flags, session?.appBundleId, session?.trace?.outPath);
}
