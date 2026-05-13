import type { WaitCommandOptions } from '../client-types.ts';
import { parseTimeout } from '../daemon/handlers/parse-utils.ts';
import { splitSelectorFromArgs, tryParseSelectorChain } from '../daemon/selectors.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { AppError } from '../utils/errors.ts';
import { selectionOptionsFromFlags, selectorSnapshotOptionsFromFlags } from './flags.ts';

export type WaitParsed =
  | { kind: 'sleep'; durationMs: number }
  | { kind: 'ref'; rawRef: string; timeoutMs: number | null }
  | { kind: 'selector'; selectorExpression: string; timeoutMs: number | null }
  | { kind: 'text'; text: string; timeoutMs: number | null };

export function readWaitOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): WaitCommandOptions {
  const parsed = parseWaitPositionals(positionals);
  if (!parsed) {
    throw new AppError(
      'INVALID_ARGS',
      'wait requires <ms>, text <text>, @ref, or <selector> [timeoutMs].',
    );
  }

  const base = {
    ...selectionOptionsFromFlags(flags),
    ...selectorSnapshotOptionsFromFlags(flags),
  };

  if (parsed.kind === 'sleep') return { ...base, durationMs: parsed.durationMs };
  if (parsed.kind === 'text') {
    if (!parsed.text) throw new AppError('INVALID_ARGS', 'wait requires text.');
    return { ...base, text: parsed.text, ...readTimeoutOption(parsed.timeoutMs) };
  }
  if (parsed.kind === 'ref') {
    return { ...base, ref: parsed.rawRef, ...readTimeoutOption(parsed.timeoutMs) };
  }
  return {
    ...base,
    selector: parsed.selectorExpression,
    ...readTimeoutOption(parsed.timeoutMs),
  };
}

export function waitOptionsToPositionals(options: WaitCommandOptions): string[] {
  const targets = [
    options.durationMs !== undefined ? 'durationMs' : undefined,
    options.text !== undefined ? 'text' : undefined,
    options.ref !== undefined ? 'ref' : undefined,
    options.selector !== undefined ? 'selector' : undefined,
  ].filter(Boolean);
  if (targets.length !== 1) {
    throw new AppError(
      'INVALID_ARGS',
      'wait command requires exactly one of durationMs, text, ref, or selector.',
    );
  }
  if (options.durationMs !== undefined) return [String(options.durationMs)];
  const timeout = options.timeoutMs !== undefined ? [String(options.timeoutMs)] : [];
  if (options.text !== undefined) return ['text', options.text, ...timeout];
  if (options.ref !== undefined) return [options.ref, ...timeout];
  const selector = options.selector!;
  assertValidSelector(selector);
  return [selector, ...timeout];
}

export function parseWaitPositionals(args: string[]): WaitParsed | null {
  if (args.length === 0) return null;

  const sleepMs = parseTimeout(args[0]);
  if (sleepMs !== null) return { kind: 'sleep', durationMs: sleepMs };

  if (args[0] === 'text') {
    const timeoutMs = parseTimeout(args[args.length - 1]);
    const text = timeoutMs !== null ? args.slice(1, -1).join(' ') : args.slice(1).join(' ');
    return { kind: 'text', text: text.trim(), timeoutMs };
  }

  if (args[0].startsWith('@')) {
    const timeoutMs = parseTimeout(args[args.length - 1]);
    return { kind: 'ref', rawRef: args[0], timeoutMs };
  }

  const timeoutMs = parseTimeout(args[args.length - 1]);
  const argsWithoutTimeout = timeoutMs !== null ? args.slice(0, -1) : args.slice();
  const split = splitSelectorFromArgs(argsWithoutTimeout);
  if (split && split.rest.length === 0 && tryParseSelectorChain(split.selectorExpression)) {
    return {
      kind: 'selector',
      selectorExpression: split.selectorExpression,
      timeoutMs,
    };
  }

  const text = timeoutMs !== null ? args.slice(0, -1).join(' ') : args.join(' ');
  return { kind: 'text', text: text.trim(), timeoutMs };
}

function assertValidSelector(selector: string): void {
  if (tryParseSelectorChain(selector)) return;
  throw new AppError('INVALID_ARGS', `Invalid wait selector: ${selector}`);
}

function readTimeoutOption(timeoutMs: number | null): { timeoutMs?: number } {
  return timeoutMs === null ? {} : { timeoutMs };
}
