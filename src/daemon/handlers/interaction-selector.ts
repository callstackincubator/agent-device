import { withDiagnosticTimer } from '../../utils/diagnostics.ts';
import { formatSelectorFailure, parseSelectorChain, resolveSelectorChain } from '../selectors.ts';
import type { SessionState } from '../types.ts';
import type { SessionStore } from '../session-store.ts';
import { captureSnapshotForSession } from './interaction-snapshot.ts';
import type { ContextFromFlags } from './interaction-common.ts';
import type { CommandFlags } from '../../core/dispatch.ts';
import type { DaemonFailureResponse } from './response.ts';

export async function resolveSelectorTarget(params: {
  command: string;
  selectorExpression: string;
  session: SessionState;
  flags: CommandFlags | undefined;
  sessionStore: SessionStore;
  contextFromFlags: ContextFromFlags;
  interactiveOnly: boolean;
  requireRect: boolean;
  requireUnique: boolean;
  disambiguateAmbiguous: boolean;
}): Promise<
  | {
      ok: true;
      chain: ReturnType<typeof parseSelectorChain>;
      snapshot: Awaited<ReturnType<typeof captureSnapshotForSession>>;
      resolved: NonNullable<Awaited<ReturnType<typeof resolveSelectorChain>>>;
    }
  | DaemonFailureResponse
> {
  const {
    command,
    selectorExpression,
    session,
    flags,
    sessionStore,
    contextFromFlags,
    interactiveOnly,
    requireRect,
    requireUnique,
    disambiguateAmbiguous,
  } = params;
  const chain = parseSelectorChain(selectorExpression);
  const snapshot = await captureSnapshotForSession(session, flags, sessionStore, contextFromFlags, {
    interactiveOnly,
  });
  const resolved = await withDiagnosticTimer(
    'selector_resolve',
    () =>
      resolveSelectorChain(snapshot.nodes, chain, {
        platform: session.device.platform,
        requireRect,
        requireUnique,
        disambiguateAmbiguous,
      }),
    { command },
  );
  if (!resolved || (requireRect && !resolved.node.rect)) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: formatSelectorFailure(chain, resolved?.diagnostics ?? [], {
          unique: requireUnique,
        }),
      },
    };
  }
  return { ok: true, chain, snapshot, resolved };
}
