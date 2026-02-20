import type { SnapshotNode } from '../utils/snapshot.ts';
import { renderSnapshotEntries, snapshotNodeToComparableLine } from '../utils/snapshot-render.ts';

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

export { snapshotNodeToComparableLine };

export function buildSnapshotDiff(previousNodes: SnapshotNode[], currentNodes: SnapshotNode[]): SnapshotDiffResult {
  const previousLines = toDiffEntries(previousNodes);
  const currentLines = toDiffEntries(currentNodes);
  const lines = diffLines(previousLines, currentLines);
  const summary = lines.reduce<SnapshotDiffSummary>(
    (acc, line) => {
      if (line.kind === 'added') acc.additions += 1;
      else if (line.kind === 'removed') acc.removals += 1;
      else acc.unchanged += 1;
      return acc;
    },
    { additions: 0, removals: 0, unchanged: 0 },
  );
  return { lines, summary };
}

type DiffEntry = {
  compare: string;
  text: string;
};

type DiffOp = {
  kind: SnapshotDiffLine['kind'];
  text: string;
};

const DIFF_LINEAR_FALLBACK_MAX_LINES = 4_000;

function diffLines(previous: DiffEntry[], current: DiffEntry[]): DiffOp[] {
  // Guard against pathological traces for very large snapshots by using a linear fallback.
  if (previous.length + current.length > DIFF_LINEAR_FALLBACK_MAX_LINES) {
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
      while (x < n && y < m && previous[x]?.compare === current[y]?.compare) {
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
  previous: DiffEntry[],
  current: DiffEntry[],
): DiffOp[] {
  const resultReversed: DiffOp[] = [];
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
      resultReversed.push({ kind: 'unchanged', text: current[y - 1]?.text ?? '' });
      x -= 1;
      y -= 1;
    }
    if (d === 0) {
      break;
    }
    if (x === prevX) {
      resultReversed.push({ kind: 'added', text: current[y - 1]?.text ?? '' });
      y -= 1;
    } else {
      resultReversed.push({ kind: 'removed', text: previous[x - 1]?.text ?? '' });
      x -= 1;
    }
  }

  return resultReversed.reverse();
}

function buildLinearFallbackDiff(
  previous: DiffEntry[],
  current: DiffEntry[],
): DiffOp[] {
  let prefix = 0;
  const min = Math.min(previous.length, current.length);
  while (prefix < min && previous[prefix]?.compare === current[prefix]?.compare) {
    prefix += 1;
  }

  let previousSuffix = previous.length - 1;
  let currentSuffix = current.length - 1;
  while (
    previousSuffix >= prefix &&
    currentSuffix >= prefix &&
    previous[previousSuffix]?.compare === current[currentSuffix]?.compare
  ) {
    previousSuffix -= 1;
    currentSuffix -= 1;
  }

  const lines: DiffOp[] = [];
  for (let i = 0; i < prefix; i += 1) {
    lines.push({ kind: 'unchanged', text: current[i]?.text ?? '' });
  }
  for (let i = prefix; i <= previousSuffix; i += 1) {
    lines.push({ kind: 'removed', text: previous[i]?.text ?? '' });
  }
  for (let i = prefix; i <= currentSuffix; i += 1) {
    lines.push({ kind: 'added', text: current[i]?.text ?? '' });
  }
  for (let i = previousSuffix + 1; i < previous.length; i += 1) {
    lines.push({ kind: 'unchanged', text: current[i]?.text ?? '' });
  }
  return lines;
}

function getOrDefault(map: Map<number, number>, key: number, fallback: number): number {
  const value = map.get(key);
  return value === undefined ? fallback : value;
}

function toDiffEntries(nodes: SnapshotNode[]): DiffEntry[] {
  return renderSnapshotEntries(nodes).map((entry) => ({
    compare: entry.compareKey,
    text: entry.displayLine,
  }));
}
