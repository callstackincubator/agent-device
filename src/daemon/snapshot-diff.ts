import type { SnapshotNode } from '../utils/snapshot.ts';
import { buildSnapshotDisplayLines, displayLabel, formatRole } from '../utils/snapshot-lines.ts';

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
  summary: SnapshotDiffSummary;
  lines: SnapshotDiffLine[];
};

type SnapshotComparableLine = {
  text: string;
  comparable: string;
};

export function snapshotNodeToComparableLine(node: SnapshotNode, depthOverride?: number): string {
  const role = formatRole(node.type ?? 'Element');
  const textPart = displayLabel(node, role);
  const enabledPart = node.enabled === false ? 'disabled' : 'enabled';
  const selectedPart = node.selected === true ? 'selected' : 'unselected';
  const hittablePart = node.hittable === true ? 'hittable' : 'not-hittable';
  const depthPart = String(depthOverride ?? node.depth ?? 0);
  return [depthPart, role, textPart, enabledPart, selectedPart, hittablePart].join('|');
}

export function buildSnapshotDiff(previousNodes: SnapshotNode[], currentNodes: SnapshotNode[]): SnapshotDiffResult {
  const previous = snapshotNodesToLines(previousNodes);
  const current = snapshotNodesToLines(currentNodes);
  const lines = diffComparableLinesMyers(previous, current);
  const summary: SnapshotDiffSummary = { additions: 0, removals: 0, unchanged: 0 };
  for (const line of lines) {
    if (line.kind === 'added') summary.additions += 1;
    if (line.kind === 'removed') summary.removals += 1;
    if (line.kind === 'unchanged') summary.unchanged += 1;
  }
  return { summary, lines };
}

export function countSnapshotComparableLines(nodes: SnapshotNode[]): number {
  return snapshotNodesToLines(nodes).length;
}

function snapshotNodesToLines(nodes: SnapshotNode[]): SnapshotComparableLine[] {
  return buildSnapshotDisplayLines(nodes).map((line) => ({
    text: line.text,
    comparable: snapshotNodeToComparableLine(line.node, line.depth),
  }));
}

function diffComparableLinesMyers(previous: SnapshotComparableLine[], current: SnapshotComparableLine[]): SnapshotDiffLine[] {
  // Myers diff is efficient for normal UI snapshots; very large trees may still be expensive.
  const n = previous.length;
  const m = current.length;
  const max = n + m;
  const v = new Map<number, number>();
  const trace: Array<Map<number, number>> = [];
  v.set(1, 0);

  for (let d = 0; d <= max; d += 1) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      const goDown = k === -d || (k !== d && getV(v, k - 1) < getV(v, k + 1));
      let x = goDown ? getV(v, k + 1) : getV(v, k - 1) + 1;
      let y = x - k;
      while (x < n && y < m && previous[x].comparable === current[y].comparable) {
        x += 1;
        y += 1;
      }
      v.set(k, x);
      if (x >= n && y >= m) {
        return backtrackMyers(trace, previous, current, n, m);
      }
    }
  }

  return [];
}

function backtrackMyers(
  trace: Array<Map<number, number>>,
  previous: SnapshotComparableLine[],
  current: SnapshotComparableLine[],
  n: number,
  m: number,
): SnapshotDiffLine[] {
  const lines: SnapshotDiffLine[] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d >= 0; d -= 1) {
    const v = trace[d];
    const k = x - y;
    const goDown = k === -d || (k !== d && getV(v, k - 1) < getV(v, k + 1));
    const prevK = goDown ? k + 1 : k - 1;
    const prevX = getV(v, prevK);
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      lines.push({ kind: 'unchanged', text: current[y - 1].text });
      x -= 1;
      y -= 1;
    }

    if (d === 0) break;

    if (x === prevX) {
      lines.push({ kind: 'added', text: current[prevY].text });
      y = prevY;
    } else {
      lines.push({ kind: 'removed', text: previous[prevX].text });
      x = prevX;
    }
  }

  lines.reverse();
  return lines;
}

function getV(v: Map<number, number>, k: number): number {
  return v.get(k) ?? 0;
}
