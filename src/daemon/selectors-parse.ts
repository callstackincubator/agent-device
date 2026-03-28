import { AppError } from '../utils/errors.ts';

export type SelectorKey =
  | 'id'
  | 'role'
  | 'text'
  | 'label'
  | 'value'
  | 'visible'
  | 'hidden'
  | 'editable'
  | 'selected'
  | 'enabled'
  | 'hittable';

export type SelectorTerm = {
  key: SelectorKey;
  value: string | boolean;
};

export type Selector = {
  raw: string;
  terms: SelectorTerm[];
};

export type SelectorChain = {
  raw: string;
  selectors: Selector[];
};

const TEXT_KEYS = new Set<SelectorKey>(['id', 'role', 'text', 'label', 'value']);
const BOOLEAN_KEYS = new Set<SelectorKey>([
  'visible',
  'hidden',
  'editable',
  'selected',
  'enabled',
  'hittable',
]);
const ALL_KEYS = new Set<SelectorKey>([...TEXT_KEYS, ...BOOLEAN_KEYS]);

export function parseSelectorChain(expression: string): SelectorChain {
  const raw = expression.trim();
  if (!raw) {
    throw new AppError('INVALID_ARGS', 'Selector expression cannot be empty');
  }
  const segments = splitByFallback(raw);
  if (segments.length === 0) {
    throw new AppError('INVALID_ARGS', 'Selector expression cannot be empty');
  }
  return {
    raw,
    selectors: segments.map((segment) => parseSelector(segment)),
  };
}

export function tryParseSelectorChain(expression: string): SelectorChain | null {
  try {
    return parseSelectorChain(expression);
  } catch {
    return null;
  }
}

export function isSelectorToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return false;
  if (trimmed === '||') return true;
  const equalsIdx = trimmed.indexOf('=');
  if (equalsIdx !== -1) {
    const key = trimmed.slice(0, equalsIdx).trim().toLowerCase() as SelectorKey;
    return ALL_KEYS.has(key);
  }
  return ALL_KEYS.has(trimmed.toLowerCase() as SelectorKey);
}

export function splitSelectorFromArgs(
  args: string[],
  options: { preferTrailingValue?: boolean } = {},
): { selectorExpression: string; rest: string[] } | null {
  if (args.length === 0) return null;
  const preferTrailingValue = options.preferTrailingValue ?? false;
  let i = 0;
  const boundaries: number[] = [];
  while (i < args.length && isSelectorToken(args[i])) {
    i += 1;
    const candidate = args.slice(0, i).join(' ').trim();
    if (!candidate) continue;
    if (tryParseSelectorChain(candidate)) {
      boundaries.push(i);
    }
  }
  if (boundaries.length === 0) return null;
  let boundary = boundaries[boundaries.length - 1];
  if (preferTrailingValue) {
    for (let i = boundaries.length - 1; i >= 0; i -= 1) {
      if (boundaries[i] < args.length) {
        boundary = boundaries[i];
        break;
      }
    }
  }
  const selectorExpression = args.slice(0, boundary).join(' ').trim();
  if (!selectorExpression) return null;
  return {
    selectorExpression,
    rest: args.slice(boundary),
  };
}

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

function parseSelector(segment: string): Selector {
  const raw = segment.trim();
  if (!raw) throw new AppError('INVALID_ARGS', 'Selector segment cannot be empty');
  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    throw new AppError('INVALID_ARGS', `Invalid selector segment: ${segment}`);
  }
  return { raw, terms: tokens.map(parseTerm) };
}

function parseTerm(token: string): SelectorTerm {
  const normalized = token.trim();
  if (!normalized) {
    throw new AppError('INVALID_ARGS', 'Empty selector term');
  }
  const equalsIdx = normalized.indexOf('=');
  if (equalsIdx === -1) {
    const key = normalized.toLowerCase() as SelectorKey;
    if (!BOOLEAN_KEYS.has(key)) {
      throw new AppError('INVALID_ARGS', `Invalid selector term "${token}", expected key=value`);
    }
    return { key, value: true };
  }
  const key = normalized.slice(0, equalsIdx).trim().toLowerCase() as SelectorKey;
  const valueRaw = normalized.slice(equalsIdx + 1).trim();
  if (!ALL_KEYS.has(key)) {
    throw new AppError('INVALID_ARGS', `Unknown selector key: ${key}`);
  }
  if (!valueRaw) {
    throw new AppError('INVALID_ARGS', `Missing selector value for key: ${key}`);
  }
  if (BOOLEAN_KEYS.has(key)) {
    const value = parseBoolean(valueRaw);
    if (value === null) {
      throw new AppError('INVALID_ARGS', `Invalid boolean value for ${key}: ${valueRaw}`);
    }
    return { key, value };
  }
  return { key, value: unquote(valueRaw) };
}

function splitByFallback(expression: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if ((ch === '"' || ch === "'") && !isEscapedQuote(expression, i)) {
      quote = updateQuoteState(quote, ch);
      current += ch;
      continue;
    }
    if (!quote && ch === '|' && expression[i + 1] === '|') {
      const segment = current.trim();
      if (!segment) {
        throw new AppError('INVALID_ARGS', `Invalid selector fallback expression: ${expression}`);
      }
      segments.push(segment);
      current = '';
      i += 1;
      continue;
    }
    current += ch;
  }
  const finalSegment = current.trim();
  if (!finalSegment) {
    throw new AppError('INVALID_ARGS', `Invalid selector fallback expression: ${expression}`);
  }
  segments.push(finalSegment);
  return segments;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < segment.length; i += 1) {
    const ch = segment[i];
    if ((ch === '"' || ch === "'") && !isEscapedQuote(segment, i)) {
      quote = updateQuoteState(quote, ch);
      current += ch;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current.trim()) tokens.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote) {
    throw new AppError('INVALID_ARGS', `Unclosed quote in selector: ${segment}`);
  }
  if (current.trim()) tokens.push(current.trim());
  return tokens;
}

function updateQuoteState(currentQuote: '"' | "'" | null, ch: '"' | "'"): '"' | "'" | null {
  if (!currentQuote) return ch;
  return currentQuote === ch ? null : currentQuote;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).replace(/\\(["'])/g, '$1');
  }
  return trimmed;
}

function parseBoolean(value: string): boolean | null {
  const normalized = unquote(value).toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

function isEscapedQuote(source: string, index: number): boolean {
  let backslashCount = 0;
  for (let i = index - 1; i >= 0 && source[i] === '\\'; i -= 1) {
    backslashCount += 1;
  }
  return backslashCount % 2 === 1;
}
