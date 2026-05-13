import type { IsOptions } from '../client-types.ts';
import { splitSelectorFromArgs } from '../daemon/selectors.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { AppError } from '../utils/errors.ts';
import { selectionOptionsFromFlags, selectorSnapshotOptionsFromFlags } from './flags.ts';

export function readIsOptionsFromPositionals(positionals: string[], flags: CliFlags): IsOptions {
  const base = {
    ...selectorSnapshotOptionsFromFlags(flags),
    ...selectionOptionsFromFlags(flags),
  };
  const predicate = positionals[0];
  const split = splitSelectorFromArgs(positionals.slice(1), {
    preferTrailingValue: predicate === 'text',
  });
  if (!split) throw new AppError('INVALID_ARGS', 'is requires a selector expression');
  if (predicate === 'text') {
    return { ...base, predicate, selector: split.selectorExpression, value: split.rest.join(' ') };
  }
  if (
    predicate === 'visible' ||
    predicate === 'hidden' ||
    predicate === 'exists' ||
    predicate === 'editable' ||
    predicate === 'selected'
  ) {
    return { ...base, predicate, selector: split.selectorExpression };
  }
  throw new AppError(
    'INVALID_ARGS',
    'is requires predicate: visible|hidden|exists|editable|selected|text',
  );
}

export function isOptionsToPositionals(options: IsOptions): string[] {
  return [
    options.predicate,
    options.selector,
    ...(options.predicate === 'text' ? [options.value] : []),
  ];
}
