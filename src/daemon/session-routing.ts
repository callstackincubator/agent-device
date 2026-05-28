import type { DaemonRequest } from './types.ts';
import { SessionStore } from './session-store.ts';
import type { CommandFlags } from '../core/dispatch.ts';

export function resolveEffectiveSessionName(
  req: DaemonRequest,
  sessionStore: SessionStore,
): string {
  const requested = req.session || 'default';
  if (hasExplicitSessionFlag(req)) return requested;
  if (requested !== 'default') return requested;
  if (sessionStore.has(requested)) return requested;

  const sessions = sessionStore.toArray();
  const session = sessions[0];
  if (session !== undefined && sessions.length === 1) return session.name;
  return requested;
}

function hasExplicitSessionFlag(req: DaemonRequest): boolean {
  const value = (req.flags as CommandFlags | undefined)?.session;
  return typeof value === 'string' && value.trim().length > 0;
}
