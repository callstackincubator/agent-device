import type { SnapshotNode } from '../utils/snapshot.ts';

export type SnapshotDiffLine = {
  kind: 'added' | 'removed' | 'unchanged';
  text: string;
};

export type SnapshotDiffSummary = {
  additions: number;
  removals: number;
  unchanged: number;
};

export type SnapshotDiffResult = {
  lines: SnapshotDiffLine[];
  summary: SnapshotDiffSummary;
};

export function snapshotNodeToComparableLine(node: SnapshotNode): string {
  const type = normalizeType(node.type);
  const label = cleanText(node.label);
  const value = cleanText(node.value);
  const identifier = cleanText(node.identifier);
  const depth = typeof node.depth === 'number' && Number.isFinite(node.depth) ? Math.max(0, Math.floor(node.depth)) : 0;
  const tokens: string[] = [];
  if (label) {
    tokens.push(`label="${label}"`);
  }
  if (value) {
    tokens.push(`value="${value}"`);
  }
  if (identifier) {
    tokens.push(`id="${identifier}"`);
  }
  if (node.enabled === false) tokens.push('disabled');
  if (node.selected === true) tokens.push('selected');
  if (node.hittable === false) tokens.push('not-hittable');
  return `${'  '.repeat(depth)}${type}${tokens.length > 0 ? ` ${tokens.join(' ')}` : ''}`;
}

export function buildSnapshotDiff(previousNodes: SnapshotNode[], currentNodes: SnapshotNode[]): SnapshotDiffResult {
  const previousLines = previousNodes.map(snapshotNodeToComparableLine);
  const currentLines = currentNodes.map(snapshotNodeToComparableLine);
  const operations = diffLines(previousLines, currentLines);
  const lines: SnapshotDiffLine[] = operations.map((operation) => ({ kind: operation.kind, text: operation.text }));
  const summary: SnapshotDiffSummary = {
    additions: lines.filter((line) => line.kind === 'added').length,
    removals: lines.filter((line) => line.kind === 'removed').length,
    unchanged: lines.filter((line) => line.kind === 'unchanged').length,
  };
  return { lines, summary };
}

function diffLines(previous: string[], current: string[]): Array<{ kind: 'added' | 'removed' | 'unchanged'; text: string }> {
  // Guard against pathological traces for very large snapshots by using a linear fallback.
  if (previous.length + current.length > 4_000) {
    return buildLinearFallbackDiff(previous, current);
  }

  const n = previous.length;
  const m = current.length;
  const max = n + m;
  const trace: Array<Map<number, number>> = [];
  let v = new Map<number, number>();
  v.set(1, 0);

  for (let d = 0; d <= max; d += 1) {
    const next = new Map<number, number>();
    for (let k = -d; k <= d; k += 2) {
      const wentDown =
        k === -d ||
        (k !== d && getOrDefault(v, k - 1, Number.NEGATIVE_INFINITY) < getOrDefault(v, k + 1, Number.NEGATIVE_INFINITY));
      const prevK = wentDown ? k + 1 : k - 1;
      let x = wentDown ? getOrDefault(v, prevK, 0) : getOrDefault(v, prevK, 0) + 1;
      let y = x - k;
      while (x < n && y < m && previous[x] === current[y]) {
        x += 1;
        y += 1;
      }
      next.set(k, x);
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrackMyers(trace, previous, current);
      }
    }
    trace.push(next);
    v = next;
  }

  return buildLinearFallbackDiff(previous, current);
}

function backtrackMyers(
  trace: Array<Map<number, number>>,
  previous: string[],
  current: string[],
): Array<{ kind: 'added' | 'removed' | 'unchanged'; text: string }> {
  const resultReversed: Array<{ kind: 'added' | 'removed' | 'unchanged'; text: string }> = [];
  let x = previous.length;
  let y = current.length;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const prev = d > 0 ? trace[d - 1] : new Map<number, number>([[1, 0]]);
    const k = x - y;
    const wentDown =
      k === -d ||
      (k !== d && getOrDefault(prev, k - 1, Number.NEGATIVE_INFINITY) < getOrDefault(prev, k + 1, Number.NEGATIVE_INFINITY));
    const prevK = wentDown ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : getOrDefault(prev, prevK, 0);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      resultReversed.push({ kind: 'unchanged', text: previous[x - 1] });
      x -= 1;
      y -= 1;
    }
    if (d === 0) {
      break;
    }
    if (x === prevX) {
      resultReversed.push({ kind: 'added', text: current[y - 1] });
      y -= 1;
    } else {
      resultReversed.push({ kind: 'removed', text: previous[x - 1] });
      x -= 1;
    }
  }

  return resultReversed.reverse();
}

function buildLinearFallbackDiff(
  previous: string[],
  current: string[],
): Array<{ kind: 'added' | 'removed' | 'unchanged'; text: string }> {
  let prefix = 0;
  const min = Math.min(previous.length, current.length);
  while (prefix < min && previous[prefix] === current[prefix]) {
    prefix += 1;
  }

  let previousSuffix = previous.length - 1;
  let currentSuffix = current.length - 1;
  while (
    previousSuffix >= prefix &&
    currentSuffix >= prefix &&
    previous[previousSuffix] === current[currentSuffix]
  ) {
    previousSuffix -= 1;
    currentSuffix -= 1;
  }

  const lines: Array<{ kind: 'added' | 'removed' | 'unchanged'; text: string }> = [];
  for (let i = 0; i < prefix; i += 1) {
    lines.push({ kind: 'unchanged', text: previous[i] });
  }
  for (let i = prefix; i <= previousSuffix; i += 1) {
    lines.push({ kind: 'removed', text: previous[i] });
  }
  for (let i = prefix; i <= currentSuffix; i += 1) {
    lines.push({ kind: 'added', text: current[i] });
  }
  for (let i = previousSuffix + 1; i < previous.length; i += 1) {
    lines.push({ kind: 'unchanged', text: previous[i] });
  }
  return lines;
}

function getOrDefault(map: Map<number, number>, key: number, fallback: number): number {
  const value = map.get(key);
  return value === undefined ? fallback : value;
}

function cleanText(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeType(type: string | undefined): string {
  const raw = cleanText(type);
  if (!raw) return 'element';
  return raw.replace(/XCUIElementType/g, '').toLowerCase();
}
