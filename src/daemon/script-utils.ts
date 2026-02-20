import type { SessionAction } from './types.ts';

const NUMERIC_ARG_RE = /^-?\d+(\.\d+)?$/;

const CLICK_LIKE_NUMERIC_FLAG_MAP = new Map<string, 'count' | 'intervalMs' | 'holdMs' | 'jitterPx'>([
  ['--count', 'count'],
  ['--interval-ms', 'intervalMs'],
  ['--hold-ms', 'holdMs'],
  ['--jitter-px', 'jitterPx'],
]);

const SWIPE_NUMERIC_FLAG_MAP = new Map<string, 'count' | 'pauseMs'>([
  ['--count', 'count'],
  ['--pause-ms', 'pauseMs'],
]);

export function isClickLikeCommand(command: string): command is 'click' | 'press' | 'dblclick' {
  return command === 'click' || command === 'press' || command === 'dblclick';
}

export function formatScriptArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) return trimmed;
  if (NUMERIC_ARG_RE.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}

export function formatScriptActionSummary(action: SessionAction): string {
  const values = (action.positionals ?? []).map((value) => formatScriptArg(value));
  return [action.command, ...values].join(' ');
}

export function appendScriptSeriesFlags(parts: string[], action: Pick<SessionAction, 'command' | 'flags'>): void {
  const flags = action.flags ?? {};
  if (isClickLikeCommand(action.command)) {
    if (typeof flags.count === 'number') parts.push('--count', String(flags.count));
    if (typeof flags.intervalMs === 'number') parts.push('--interval-ms', String(flags.intervalMs));
    if (typeof flags.holdMs === 'number') parts.push('--hold-ms', String(flags.holdMs));
    if (typeof flags.jitterPx === 'number') parts.push('--jitter-px', String(flags.jitterPx));
    if (flags.doubleTap === true) parts.push('--double-tap');
    return;
  }
  if (action.command === 'swipe') {
    if (typeof flags.count === 'number') parts.push('--count', String(flags.count));
    if (typeof flags.pauseMs === 'number') parts.push('--pause-ms', String(flags.pauseMs));
    if (flags.pattern === 'one-way' || flags.pattern === 'ping-pong') {
      parts.push('--pattern', flags.pattern);
    }
  }
}

export function parseReplaySeriesFlags(command: string, args: string[]): { positionals: string[]; flags: SessionAction['flags'] } {
  const positionals: string[] = [];
  const flags: SessionAction['flags'] = {};

  const numericFlagMap = isClickLikeCommand(command)
    ? CLICK_LIKE_NUMERIC_FLAG_MAP
    : command === 'swipe'
      ? SWIPE_NUMERIC_FLAG_MAP
      : undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (isClickLikeCommand(command) && token === '--double-tap') {
      flags.doubleTap = true;
      continue;
    }

    const numericKey = numericFlagMap?.get(token);
    if (numericKey && index + 1 < args.length) {
      const parsed = parseNonNegativeIntToken(args[index + 1]);
      if (parsed !== null) {
        flags[numericKey] = parsed;
      }
      index += 1;
      continue;
    }

    if (command === 'swipe' && token === '--pattern' && index + 1 < args.length) {
      const pattern = args[index + 1];
      if (pattern === 'one-way' || pattern === 'ping-pong') {
        flags.pattern = pattern;
      }
      index += 1;
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}

function parseNonNegativeIntToken(token: string | undefined): number | null {
  if (!token) return null;
  const value = Number(token);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.floor(value);
}
