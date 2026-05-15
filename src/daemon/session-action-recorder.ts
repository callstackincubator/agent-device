import type { CommandFlags } from '../core/dispatch.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import type { SessionAction, SessionRuntimeHints, SessionState } from './types.ts';
import { expandSessionPath } from './session-paths.ts';

export type RecordActionEntry = {
  command: string;
  positionals: string[];
  flags: CommandFlags;
  runtime?: SessionRuntimeHints;
  result?: Record<string, unknown>;
};

export function recordActionEntry(session: SessionState, entry: RecordActionEntry): void {
  if (entry.flags?.noRecord) return;
  if (entry.flags?.saveScript) {
    session.recordSession = true;
    if (typeof entry.flags.saveScript === 'string') {
      session.saveScriptPath = expandSessionPath(entry.flags.saveScript);
    }
  }
  session.actions.push({
    ts: Date.now(),
    command: entry.command,
    positionals: entry.positionals,
    runtime: entry.runtime,
    flags: sanitizeFlags(entry.flags),
    result: entry.result,
  });
  emitDiagnostic({
    level: 'debug',
    phase: 'record_action',
    data: {
      command: entry.command,
      session: session.name,
    },
  });
}

const SANITIZED_FLAG_KEYS = [
  'platform',
  'device',
  'udid',
  'serial',
  'out',
  'verbose',
  'metroHost',
  'metroPort',
  'bundleUrl',
  'launchUrl',
  'snapshotInteractiveOnly',
  'snapshotCompact',
  'snapshotDepth',
  'snapshotScope',
  'snapshotRaw',
  'screenshotFullscreen',
  'screenshotMaxSize',
  'screenshotNoStabilize',
  'relaunch',
  'saveScript',
  'noRecord',
  'fps',
  'quality',
  'hideTouches',
  'count',
  'intervalMs',
  'delayMs',
  'holdMs',
  'jitterPx',
  'doubleTap',
  'clickButton',
  'pauseMs',
  'pattern',
] as const satisfies readonly (keyof CommandFlags)[];

function sanitizeFlags(flags: CommandFlags | undefined): SessionAction['flags'] {
  if (!flags) return {};
  const result: Record<string, unknown> = {};
  for (const key of SANITIZED_FLAG_KEYS) {
    if (flags[key] !== undefined) {
      result[key] = flags[key];
    }
  }
  return result as SessionAction['flags'];
}
