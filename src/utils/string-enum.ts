import { AppError } from './errors.ts';

/**
 * Membership guard for an `as const` string tuple (the single source of truth for
 * a string-literal union). Narrows `value` to the tuple's element union.
 */
export function isStringMember<const T extends readonly string[]>(
  values: T,
  value: string,
): value is T[number] {
  return values.includes(value);
}

/**
 * Strict (exact-match) parse for an `as const` string tuple. Throws an
 * `INVALID_ARGS` AppError when `value` is not a member. Pass `normalize` to
 * trim/lowercase before matching, and `message` for a custom error.
 *
 * Note: only for strict vocabularies — parsers that accept aliases (e.g.
 * device rotation `left` -> `landscape-left`) keep their own logic.
 */
export function parseStringMember<const T extends readonly string[]>(
  values: T,
  value: string | undefined,
  options: { normalize?: (raw: string) => string; message?: string } = {},
): T[number] {
  const normalized = value === undefined ? undefined : (options.normalize?.(value) ?? value);
  if (normalized !== undefined && isStringMember(values, normalized)) {
    return normalized;
  }
  throw new AppError(
    'INVALID_ARGS',
    options.message ?? `Invalid value: ${value}. Use ${values.join('|')}.`,
  );
}
