import { splitSelectorFromArgs, tryParseSelectorChain, type SelectorChain } from '../selectors.ts';
import { parseTimeout } from './parse-utils.ts';

export type WaitParsed =
  | { kind: 'sleep'; durationMs: number }
  | { kind: 'ref'; rawRef: string; timeoutMs: number | null }
  | {
      kind: 'selector';
      selector: SelectorChain;
      selectorExpression: string;
      timeoutMs: number | null;
    }
  | { kind: 'text'; text: string; timeoutMs: number | null };

export function parseWaitArgs(args: string[]): WaitParsed | null {
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
  if (split && split.rest.length === 0) {
    const selector = tryParseSelectorChain(split.selectorExpression);
    if (selector) {
      return {
        kind: 'selector',
        selector,
        selectorExpression: split.selectorExpression,
        timeoutMs,
      };
    }
  }

  const text = timeoutMs !== null ? args.slice(0, -1).join(' ') : args.join(' ');
  return { kind: 'text', text: text.trim(), timeoutMs };
}

export function waitNeedsRunnerCleanup(parsed: WaitParsed): boolean {
  return parsed.kind !== 'sleep';
}
