import type { FindOptions } from '../client-types.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { AppError } from '../utils/errors.ts';
import type { FindLocator } from '../utils/finders.ts';
import { selectionOptionsFromFlags } from './flags.ts';

export function readFindOptionsFromPositionals(
  positionals: string[],
  flags: CliFlags,
): FindOptions {
  const base = {
    ...findSnapshotOptionsFromFlags(flags),
    ...selectionOptionsFromFlags(flags),
    first: flags.findFirst,
    last: flags.findLast,
  };
  const locator = readFindLocator(positionals[0]);
  const hasExplicitLocator = locator !== undefined;
  const query = hasExplicitLocator ? positionals[1] : positionals[0];
  const actionOffset = hasExplicitLocator ? 2 : 1;
  const action = positionals[actionOffset];
  if (action === undefined) {
    return { ...base, locator, query: readRequiredQuery(query) };
  }
  if (action === 'get') {
    const subcommand = positionals[actionOffset + 1];
    if (subcommand === 'text') {
      return { ...base, locator, query: readRequiredQuery(query), action: 'getText' };
    }
    if (subcommand === 'attrs') {
      return {
        ...base,
        locator,
        query: readRequiredQuery(query),
        action: 'getAttrs',
      };
    }
    throw new AppError('INVALID_ARGS', 'find get only supports text or attrs');
  }
  if (action === 'wait') {
    return {
      ...base,
      locator,
      query: readRequiredQuery(query),
      action: 'wait',
      timeoutMs: readOptionalTimeoutMs(positionals[actionOffset + 1]),
    };
  }
  if (action === 'fill' || action === 'type') {
    return {
      ...base,
      locator,
      query: readRequiredQuery(query),
      action,
      value: positionals.slice(actionOffset + 1).join(' '),
    };
  }
  if (action === 'click' || action === 'focus' || action === 'exists') {
    return { ...base, locator, query: readRequiredQuery(query), action };
  }
  throw new AppError('INVALID_ARGS', `Unsupported find action: ${action}`);
}

export function findOptionsToPositionals(options: FindOptions): string[] {
  const args =
    options.locator && options.locator !== 'any'
      ? [options.locator, options.query]
      : [options.query];
  switch (options.action) {
    case undefined:
    case 'click':
    case 'focus':
    case 'exists':
      return options.action ? [...args, options.action] : args;
    case 'getText':
      return [...args, 'get', 'text'];
    case 'getAttrs':
      return [...args, 'get', 'attrs'];
    case 'wait':
      return [...args, 'wait', ...optionalNumberValue(options.timeoutMs)];
    case 'fill':
    case 'type':
      return [...args, options.action, options.value];
  }
}

function readFindLocator(value: string | undefined): FindLocator | undefined {
  if (
    value === 'text' ||
    value === 'label' ||
    value === 'value' ||
    value === 'role' ||
    value === 'id'
  ) {
    return value;
  }
  return undefined;
}

function findSnapshotOptionsFromFlags(flags: CliFlags): {
  depth?: number;
  raw?: boolean;
} {
  return {
    depth: flags.snapshotDepth,
    raw: flags.snapshotRaw,
  };
}

function readRequiredQuery(value: string | undefined): string {
  if (value === undefined || value === '') {
    throw new AppError('INVALID_ARGS', 'find requires query');
  }
  return value;
}

function readOptionalTimeoutMs(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function optionalNumberValue(value: number | undefined): string[] {
  return value === undefined ? [] : [String(value)];
}
