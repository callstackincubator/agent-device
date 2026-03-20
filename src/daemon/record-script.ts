import type { SessionAction } from './types.ts';
import { formatScriptArg } from './script-utils.ts';

type RecordScriptParseResult = Pick<SessionAction, 'positionals' | 'flags'>;

export function parseRecordScriptArgs(args: string[]): RecordScriptParseResult {
  const action: RecordScriptParseResult = {
    positionals: [],
    flags: {},
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--hide-touches') {
      action.flags.hideTouches = true;
      continue;
    }
    if (token === '--fps' && index + 1 < args.length) {
      const parsedFps = Number(args[index + 1]);
      if (Number.isFinite(parsedFps) && parsedFps >= 1) {
        action.flags.fps = Math.floor(parsedFps);
      }
      index += 1;
      continue;
    }
    action.positionals.push(token);
  }

  return action;
}

export function appendRecordActionScriptParts(parts: string[], action: SessionAction): void {
  for (const [index, positional] of (action.positionals ?? []).entries()) {
    if (index === 0 && (positional === 'start' || positional === 'stop')) {
      parts.push(positional);
      continue;
    }
    parts.push(formatScriptArg(positional));
  }
  if (typeof action.flags?.fps === 'number') {
    parts.push('--fps', String(action.flags.fps));
  }
  if (action.flags?.hideTouches) {
    parts.push('--hide-touches');
  }
}
