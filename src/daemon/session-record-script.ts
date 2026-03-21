import type { SessionAction } from './types.ts';
import { formatScriptArg, formatScriptArgQuoteIfNeeded } from './script-utils.ts';

export function appendRecordActionScriptArgs(parts: string[], action: SessionAction): void {
  const [subcommand, ...rest] = action.positionals ?? [];
  if (subcommand) {
    parts.push(formatScriptArgQuoteIfNeeded(subcommand));
  }
  for (const positional of rest) {
    parts.push(formatScriptArg(positional));
  }
  if (typeof action.flags?.fps === 'number') {
    parts.push('--fps', String(action.flags.fps));
  }
  if (action.flags?.hideTouches) {
    parts.push('--hide-touches');
  }
}
