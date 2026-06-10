import { splitSelectorFromArgs } from '../utils/selectors-parse.ts';

export * from '../utils/selectors-parse.ts';

export function splitIsSelectorArgs(positionals: string[]): {
  predicate: string;
  split: { selectorExpression: string; rest: string[] } | null;
} {
  const predicate = positionals[0] ?? '';
  const split = splitSelectorFromArgs(positionals.slice(1), {
    preferTrailingValue: predicate === 'text',
  });
  return { predicate, split };
}
