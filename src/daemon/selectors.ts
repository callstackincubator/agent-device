import { AppError } from '../utils/errors.ts';
import type { SnapshotNode, SnapshotState } from '../utils/snapshot.ts';
import { extractNodeText, isFillableType, normalizeType } from './snapshot-processing.ts';
import { uniqueStrings } from './action-utils.ts';

type SelectorKey =
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

type SelectorTerm = {
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

export type SelectorDiagnostics = {
  selector: string;
  matches: number;
};

export type SelectorResolution = {
  node: SnapshotNode;
  selector: Selector;
  selectorIndex: number;
  matches: number;
  diagnostics: SelectorDiagnostics[];
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

export function resolveSelectorChain(
  nodes: SnapshotState['nodes'],
  chain: SelectorChain,
  options: {
    platform: 'ios' | 'android';
    requireRect?: boolean;
    requireUnique?: boolean;
  },
): SelectorResolution | null {
  const requireRect = options.requireRect ?? false;
  const requireUnique = options.requireUnique ?? true;
  const diagnostics: SelectorDiagnostics[] = [];
  for (let i = 0; i < chain.selectors.length; i += 1) {
    const selector = chain.selectors[i];
    const matches = nodes.filter((node) => {
      if (requireRect && !node.rect) return false;
      return matchesSelector(node, selector, options.platform);
    });
    diagnostics.push({ selector: selector.raw, matches: matches.length });
    if (matches.length === 0) continue;
    if (requireUnique && matches.length !== 1) continue;
    return {
      node: matches[0],
      selector,
      selectorIndex: i,
      matches: matches.length,
      diagnostics,
    };
  }
  return null;
}

export function findSelectorChainMatch(
  nodes: SnapshotState['nodes'],
  chain: SelectorChain,
  options: {
    platform: 'ios' | 'android';
    requireRect?: boolean;
  },
): { selectorIndex: number; selector: Selector; matches: number; diagnostics: SelectorDiagnostics[] } | null {
  const requireRect = options.requireRect ?? false;
  const diagnostics: SelectorDiagnostics[] = [];
  for (let i = 0; i < chain.selectors.length; i += 1) {
    const selector = chain.selectors[i];
    const matches = nodes.filter((node) => {
      if (requireRect && !node.rect) return false;
      return matchesSelector(node, selector, options.platform);
    });
    diagnostics.push({ selector: selector.raw, matches: matches.length });
    if (matches.length > 0) {
      return { selectorIndex: i, selector, matches: matches.length, diagnostics };
    }
  }
  return null;
}

export function formatSelectorFailure(
  chain: SelectorChain,
  diagnostics: SelectorDiagnostics[],
  options: { unique?: boolean },
): string {
  const unique = options.unique ?? true;
  if (diagnostics.length === 0) {
    return `Selector did not match: ${chain.raw}`;
  }
  const summary = diagnostics.map((entry) => `${entry.selector} -> ${entry.matches}`).join(', ');
  if (unique) {
    return `Selector did not resolve uniquely (${summary})`;
  }
  return `Selector did not match (${summary})`;
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

export function splitSelectorFromArgs(args: string[]): { selectorExpression: string; rest: string[] } | null {
  if (args.length === 0) return null;
  let i = 0;
  while (i < args.length && isSelectorToken(args[i])) {
    i += 1;
  }
  if (i === 0) return null;
  const selectorExpression = args.slice(0, i).join(' ').trim();
  if (!selectorExpression) return null;
  return {
    selectorExpression,
    rest: args.slice(i),
  };
}

export function isNodeVisible(node: SnapshotNode): boolean {
  if (node.hittable === true) return true;
  if (!node.rect) return false;
  return node.rect.width > 0 && node.rect.height > 0;
}

export function isNodeEditable(node: SnapshotNode, platform: 'ios' | 'android'): boolean {
  const type = node.type ?? '';
  return isFillableType(type, platform) && node.enabled !== false;
}

export function buildSelectorChainForNode(
  node: SnapshotNode,
  platform: 'ios' | 'android',
  options: { action?: 'click' | 'fill' | 'get' } = {},
): string[] {
  const chain: string[] = [];
  const role = normalizeType(node.type ?? '');
  const id = normalizeSelectorText(node.identifier);
  const label = normalizeSelectorText(node.label);
  const value = normalizeSelectorText(node.value);
  const text = normalizeSelectorText(extractNodeText(node));
  const requireEditable = options.action === 'fill';

  if (id) {
    chain.push(`id=${quoteSelectorValue(id)}`);
  }
  if (role && label) {
    chain.push(
      requireEditable
        ? `role=${quoteSelectorValue(role)} label=${quoteSelectorValue(label)} editable=true`
        : `role=${quoteSelectorValue(role)} label=${quoteSelectorValue(label)}`,
    );
  }
  if (label) {
    chain.push(requireEditable ? `label=${quoteSelectorValue(label)} editable=true` : `label=${quoteSelectorValue(label)}`);
  }
  if (value) {
    chain.push(requireEditable ? `value=${quoteSelectorValue(value)} editable=true` : `value=${quoteSelectorValue(value)}`);
  }
  if (text && text !== label && text !== value) {
    chain.push(requireEditable ? `text=${quoteSelectorValue(text)} editable=true` : `text=${quoteSelectorValue(text)}`);
  }
  if (role && requireEditable && !chain.some((entry) => entry.includes('editable=true'))) {
    chain.push(`role=${quoteSelectorValue(role)} editable=true`);
  }

  const deduped = uniqueStrings(chain);
  if (deduped.length === 0 && role) {
    deduped.push(requireEditable ? `role=${quoteSelectorValue(role)} editable=true` : `role=${quoteSelectorValue(role)}`);
  }
  if (deduped.length === 0) {
    const visible = isNodeVisible(node);
    if (visible) deduped.push('visible=true');
  }
  return deduped;
}

function parseSelector(segment: string): Selector {
  const raw = segment.trim();
  if (!raw) throw new AppError('INVALID_ARGS', 'Selector segment cannot be empty');
  const tokens = tokenize(raw);
  if (tokens.length === 0) {
    throw new AppError('INVALID_ARGS', `Invalid selector segment: ${segment}`);
  }
  const terms = tokens.map(parseTerm);
  return { raw, terms };
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
  const keyRaw = normalized.slice(0, equalsIdx).trim().toLowerCase() as SelectorKey;
  const valueRaw = normalized.slice(equalsIdx + 1).trim();
  if (!ALL_KEYS.has(keyRaw)) {
    throw new AppError('INVALID_ARGS', `Unknown selector key: ${keyRaw}`);
  }
  if (!valueRaw) {
    throw new AppError('INVALID_ARGS', `Missing selector value for key: ${keyRaw}`);
  }
  if (BOOLEAN_KEYS.has(keyRaw)) {
    const parsedBoolean = parseBoolean(valueRaw);
    if (parsedBoolean === null) {
      throw new AppError('INVALID_ARGS', `Invalid boolean value for ${keyRaw}: ${valueRaw}`);
    }
    return { key: keyRaw, value: parsedBoolean };
  }
  return { key: keyRaw, value: unquote(valueRaw) };
}

function matchesSelector(node: SnapshotNode, selector: Selector, platform: 'ios' | 'android'): boolean {
  return selector.terms.every((term) => matchesTerm(node, term, platform));
}

function matchesTerm(node: SnapshotNode, term: SelectorTerm, platform: 'ios' | 'android'): boolean {
  switch (term.key) {
    case 'id':
      return textEquals(node.identifier, String(term.value));
    case 'role':
      return roleEquals(node.type, String(term.value));
    case 'label':
      return textEquals(node.label, String(term.value));
    case 'value':
      return textEquals(node.value, String(term.value));
    case 'text': {
      const query = normalizeText(String(term.value));
      return normalizeText(extractNodeText(node)) === query;
    }
    case 'visible':
      return isNodeVisible(node) === Boolean(term.value);
    case 'hidden':
      return (!isNodeVisible(node)) === Boolean(term.value);
    case 'editable':
      return isNodeEditable(node, platform) === Boolean(term.value);
    case 'selected':
      return Boolean(node.selected === true) === Boolean(term.value);
    case 'enabled':
      return Boolean(node.enabled !== false) === Boolean(term.value);
    case 'hittable':
      return Boolean(node.hittable === true) === Boolean(term.value);
    default:
      return false;
  }
}

function splitByFallback(expression: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];
    if ((ch === '"' || ch === "'") && expression[i - 1] !== '\\') {
      if (!quote) {
        quote = ch;
      } else if (quote === ch) {
        quote = null;
      }
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
    if ((ch === '"' || ch === "'") && segment[i - 1] !== '\\') {
      if (!quote) {
        quote = ch;
      } else if (quote === ch) {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current.trim().length > 0) {
        tokens.push(current.trim());
      }
      current = '';
      continue;
    }
    current += ch;
  }
  if (quote) {
    throw new AppError('INVALID_ARGS', `Unclosed quote in selector: ${segment}`);
  }
  if (current.trim().length > 0) {
    tokens.push(current.trim());
  }
  return tokens;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
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

function textEquals(value: string | undefined, query: string): boolean {
  return normalizeText(value ?? '') === normalizeText(query);
}

function roleEquals(value: string | undefined, query: string): boolean {
  return normalizeRole(value ?? '') === normalizeRole(query);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizeRole(value: string): string {
  return normalizeType(value);
}

function quoteSelectorValue(value: string): string {
  return JSON.stringify(value);
}

function normalizeSelectorText(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}
