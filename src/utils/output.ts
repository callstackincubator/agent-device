import path from 'node:path';
import { AppError, normalizeError, type NormalizedError } from './errors.ts';
import { buildSnapshotDisplayLines, formatSnapshotLine } from './snapshot-lines.ts';
import type { SnapshotNode } from './snapshot.ts';
import type { ScreenshotDiffResult } from './screenshot-diff.ts';
import { styleText } from 'node:util';
import { isRectVisibleInViewport, resolveViewportRect } from '../daemon/scroll-planner.ts';

type JsonResult =
  | { success: true; data?: unknown }
  | {
      success: false;
      error: {
        code: string;
        message: string;
        hint?: string;
        diagnosticId?: string;
        logPath?: string;
        details?: Record<string, unknown>;
      };
    };

export function printJson(result: JsonResult): void {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function printHumanError(
  err: AppError | NormalizedError,
  options: { showDetails?: boolean } = {},
): void {
  const normalized = err instanceof AppError ? normalizeError(err) : err;
  process.stderr.write(`Error (${normalized.code}): ${normalized.message}\n`);
  if (normalized.hint) {
    process.stderr.write(`Hint: ${normalized.hint}\n`);
  }
  if (normalized.diagnosticId) {
    process.stderr.write(`Diagnostic ID: ${normalized.diagnosticId}\n`);
  }
  if (normalized.logPath) {
    process.stderr.write(`Diagnostics Log: ${normalized.logPath}\n`);
  }
  if (options.showDetails && normalized.details) {
    process.stderr.write(`${JSON.stringify(normalized.details, null, 2)}\n`);
  }
}

type SnapshotDiffLine = {
  kind?: 'added' | 'removed' | 'unchanged';
  text?: string;
};

export function formatSnapshotText(
  data: Record<string, unknown>,
  options: { raw?: boolean; flatten?: boolean } = {},
): string {
  const rawNodes = data.nodes;
  const nodes = Array.isArray(rawNodes) ? (rawNodes as SnapshotNode[]) : [];
  const visiblePresentation = options.raw ? null : buildVisibleSnapshotPresentation(nodes);
  const truncated = Boolean(data.truncated);
  const appName = typeof data.appName === 'string' ? data.appName : undefined;
  const appBundleId = typeof data.appBundleId === 'string' ? data.appBundleId : undefined;
  const meta: string[] = [];
  if (appName) meta.push(`Page: ${appName}`);
  if (appBundleId) meta.push(`App: ${appBundleId}`);
  const displayedNodes = visiblePresentation?.nodes ?? nodes;
  const hiddenCount = visiblePresentation?.hiddenCount ?? 0;
  const header =
    hiddenCount > 0
      ? `Snapshot: ${displayedNodes.length} visible nodes (${nodes.length} total)${truncated ? ' (truncated)' : ''}`
      : `Snapshot: ${nodes.length} nodes${truncated ? ' (truncated)' : ''}`;
  const prefix = meta.length > 0 ? `${meta.join('\n')}\n` : '';
  const notices = buildSnapshotNotices(data, nodes, options);
  const noticesBlock = notices.length > 0 ? `${notices.join('\n')}\n` : '';
  if (nodes.length === 0) {
    return `${prefix}${header}\n${noticesBlock}`;
  }
  if (options.raw) {
    const rawLines = nodes.map((node) => JSON.stringify(node));
    return `${prefix}${header}\n${noticesBlock}${rawLines.join('\n')}\n`;
  }
  if (options.flatten) {
    const flatLines = displayedNodes.map((node) =>
      formatSnapshotLine(node, 0, false, undefined, { summarizeTextSurfaces: true }),
    );
    const summaryBlock =
      visiblePresentation && visiblePresentation.summaryLines.length > 0
        ? `\n${visiblePresentation.summaryLines.join('\n')}`
        : '';
    return `${prefix}${header}\n${noticesBlock}${flatLines.join('\n')}${summaryBlock}\n`;
  }
  const lines = buildSnapshotDisplayLines(displayedNodes, { summarizeTextSurfaces: true }).map(
    (line) => line.text,
  );
  const summaryBlock =
    visiblePresentation && visiblePresentation.summaryLines.length > 0
      ? `\n${visiblePresentation.summaryLines.join('\n')}`
      : '';
  return `${prefix}${header}\n${noticesBlock}${lines.join('\n')}${summaryBlock}\n`;
}

export function formatSnapshotDiffText(data: Record<string, unknown>): string {
  const baselineInitialized = data.baselineInitialized === true;
  const summaryRaw = (data.summary ?? {}) as Record<string, unknown>;
  const additions = toNumber(summaryRaw.additions);
  const removals = toNumber(summaryRaw.removals);
  const unchanged = toNumber(summaryRaw.unchanged);
  const useColor = supportsColor();
  const notices = readSnapshotWarnings(data);
  const noticesBlock = notices.length > 0 ? `${notices.join('\n')}\n` : '';
  if (baselineInitialized) {
    return `${noticesBlock}Baseline initialized (${unchanged} lines).\n`;
  }
  const rawLines = Array.isArray(data.lines) ? (data.lines as SnapshotDiffLine[]) : [];
  const contextLines = applyContextWindow(rawLines, 1);
  const lines = contextLines.map((line) => {
    const text = typeof line.text === 'string' ? line.text : '';
    if (line.kind === 'added') {
      const prefix = text.startsWith(' ') ? `+${text}` : `+ ${text}`;
      return useColor ? colorize(prefix, 'green') : prefix;
    }
    if (line.kind === 'removed') {
      const prefix = text.startsWith(' ') ? `-${text}` : `- ${text}`;
      return useColor ? colorize(prefix, 'red') : prefix;
    }
    return useColor ? colorize(text, 'dim') : text;
  });
  const body = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  if (!useColor) {
    return `${noticesBlock}${body}${additions} additions, ${removals} removals, ${unchanged} unchanged\n`;
  }
  const summary = [
    `${colorize(String(additions), 'green')} additions`,
    `${colorize(String(removals), 'red')} removals`,
    `${colorize(String(unchanged), 'dim')} unchanged`,
  ].join(', ');
  return `${noticesBlock}${body}${summary}\n`;
}

export function formatScreenshotDiffText(data: ScreenshotDiffResult): string {
  const useColor = supportsColor();
  const match = data.match === true;
  const differentPixels = toNumber(data.differentPixels);
  const totalPixels = toNumber(data.totalPixels);
  const mismatchPercentage = toNumber(data.mismatchPercentage);
  const diffPath = data.diffPath;
  const dimensionMismatch = data.dimensionMismatch;

  const lines: string[] = [];

  if (match) {
    const indicator = useColor ? colorize('✓', 'green') : '✓';
    lines.push(`${indicator} Screenshots match.`);
  } else if (dimensionMismatch) {
    const indicator = useColor ? colorize('✗', 'red') : '✗';
    const expected = dimensionMismatch.expected;
    const actual = dimensionMismatch.actual;
    lines.push(
      `${indicator} Screenshots have different dimensions: ` +
        `expected ${expected?.width}x${expected?.height}, ` +
        `got ${actual?.width}x${actual?.height}`,
    );
  } else {
    const indicator = useColor ? colorize('✗', 'red') : '✗';
    const pctLabel =
      mismatchPercentage === 0 && differentPixels > 0 ? '<0.01' : String(mismatchPercentage);
    lines.push(`${indicator} ${pctLabel}% pixels differ`);
  }

  if (diffPath && !match) {
    const relativePath = toRelativePath(diffPath);
    const label = useColor ? colorize('Diff image:', 'dim') : 'Diff image:';
    const displayPath = useColor ? colorize(relativePath, 'green') : relativePath;
    lines.push(`  ${label} ${displayPath}`);
  }

  if (!match && !dimensionMismatch) {
    const diffCount = useColor ? colorize(String(differentPixels), 'red') : String(differentPixels);
    lines.push(`  ${diffCount} different / ${totalPixels} total pixels`);
  }

  return `${lines.join('\n')}\n`;
}

function toRelativePath(filePath: string): string {
  const cwd = process.cwd();
  const relativePath = path.relative(cwd, filePath);
  if (relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))) {
    return relativePath === '' ? '.' : `.${path.sep}${relativePath}`;
  }
  return filePath;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function applyContextWindow(lines: SnapshotDiffLine[], contextWindow: number): SnapshotDiffLine[] {
  if (lines.length === 0) return lines;
  const changedIndices = lines
    .map((line, index) => ({ index, kind: line.kind }))
    .filter((entry) => entry.kind === 'added' || entry.kind === 'removed')
    .map((entry) => entry.index);
  if (changedIndices.length === 0) return lines;

  const keep = new Array<boolean>(lines.length).fill(false);
  for (const index of changedIndices) {
    const start = Math.max(0, index - contextWindow);
    const end = Math.min(lines.length - 1, index + contextWindow);
    for (let i = start; i <= end; i += 1) {
      keep[i] = true;
    }
  }
  return lines.filter((_, index) => keep[index]);
}

function supportsColor(): boolean {
  const forceColor = process.env.FORCE_COLOR;
  if (typeof forceColor === 'string') {
    return forceColor !== '0';
  }
  if (typeof process.env.NO_COLOR === 'string') {
    return false;
  }
  return Boolean(process.stdout.isTTY);
}

function colorize(text: string, format: Parameters<typeof styleText>[0]): string {
  return styleText(format, text);
}

function buildSnapshotNotices(
  data: Record<string, unknown>,
  nodes: SnapshotNode[],
  options: { raw?: boolean; flatten?: boolean },
): string[] {
  const notices = readSnapshotWarnings(data);
  if (!options.raw && detectPossibleRepeatedNavSubtree(nodes)) {
    notices.push('Warning: possible repeated nav subtree detected.');
  }
  return notices;
}

function readSnapshotWarnings(data: Record<string, unknown>): string[] {
  const rawWarnings = data.warnings;
  if (!Array.isArray(rawWarnings)) {
    return [];
  }
  return rawWarnings.filter(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0,
  );
}

function detectPossibleRepeatedNavSubtree(nodes: SnapshotNode[]): boolean {
  if (nodes.length < 20) {
    return false;
  }
  const counts = new Map<string, number>();
  for (const node of nodes) {
    const type = (node.type ?? '').toLowerCase();
    const label = displayNodeLabel(node).trim().toLowerCase();
    if (!label) continue;
    const signature = `${type}|${label}`;
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  let duplicateCount = 0;
  for (const count of counts.values()) {
    if (count > 1) {
      duplicateCount += count;
    }
  }
  return duplicateCount >= 8;
}

function displayNodeLabel(node: SnapshotNode): string {
  return node.label?.trim() || node.value?.trim() || node.identifier?.trim() || '';
}

function buildVisibleSnapshotPresentation(nodes: SnapshotNode[]): {
  nodes: SnapshotNode[];
  hiddenCount: number;
  summaryLines: string[];
} {
  if (nodes.length === 0) {
    return { nodes, hiddenCount: 0, summaryLines: [] };
  }

  const visibleNodeIndexes = new Set<number>();
  const visibleDirectionCandidates: SnapshotNode[] = [];
  const byIndex = new Map(nodes.map((node) => [node.index, node]));

  for (const node of nodes) {
    const visibility = classifyNodeVisibility(node, nodes);
    if (visibility === 'visible') {
      visibleNodeIndexes.add(node.index);
      let current: SnapshotNode | undefined = node;
      const visited = new Set<number>();
      while (current && !visited.has(current.index)) {
        visited.add(current.index);
        visibleNodeIndexes.add(current.index);
        current =
          typeof current.parentIndex === 'number' ? byIndex.get(current.parentIndex) : undefined;
      }
      continue;
    }
    if (visibility !== 'offscreen') {
      continue;
    }
    if (isDiscoverableOffscreenNode(node)) {
      visibleDirectionCandidates.push(node);
    }
  }

  if (visibleNodeIndexes.size === 0) {
    return {
      nodes,
      hiddenCount: 0,
      summaryLines: buildOffscreenSummaryLines(visibleDirectionCandidates, nodes),
    };
  }

  const visibleNodes = nodes.filter((node) => visibleNodeIndexes.has(node.index));
  return {
    nodes: visibleNodes,
    hiddenCount: nodes.length - visibleNodes.length,
    summaryLines: buildOffscreenSummaryLines(visibleDirectionCandidates, nodes),
  };
}

function classifyNodeVisibility(
  node: SnapshotNode,
  nodes: SnapshotNode[],
): 'visible' | 'offscreen' | 'unknown' {
  if (!node.rect) {
    return 'visible';
  }
  const viewport = resolveViewportRect(nodes, node.rect);
  if (!viewport) {
    return 'visible';
  }
  return isRectVisibleInViewport(node.rect, viewport) ? 'visible' : 'offscreen';
}

function buildOffscreenSummaryLines(
  nodes: SnapshotNode[],
  snapshotNodes: SnapshotNode[],
): string[] {
  const groups = new Map<'above' | 'below' | 'left' | 'right', SnapshotNode[]>();
  for (const node of nodes) {
    const direction = classifyOffscreenDirection(node, snapshotNodes);
    if (!direction) {
      continue;
    }
    const group = groups.get(direction) ?? [];
    group.push(node);
    groups.set(direction, group);
  }

  return ['above', 'below', 'left', 'right'].flatMap((direction) => {
    const group = groups.get(direction as 'above' | 'below' | 'left' | 'right');
    if (!group || group.length === 0) {
      return [];
    }
    const labels = uniqueLabels(group)
      .slice(0, 3)
      .map((label) => `"${label}"`);
    const noun = group.length === 1 ? 'interactive item' : 'interactive items';
    const suffix = labels.length > 0 ? `: ${labels.join(', ')}` : '';
    return [`[off-screen ${direction}] ${group.length} ${noun}${suffix}`];
  });
}

function classifyOffscreenDirection(
  node: SnapshotNode,
  nodes: SnapshotNode[],
): 'above' | 'below' | 'left' | 'right' | null {
  if (!node.rect) {
    return null;
  }
  const viewport = resolveViewportRect(nodes, node.rect);
  if (!viewport) {
    return null;
  }
  if (node.rect.y + node.rect.height <= viewport.y) {
    return 'above';
  }
  if (node.rect.y >= viewport.y + viewport.height) {
    return 'below';
  }
  if (node.rect.x + node.rect.width <= viewport.x) {
    return 'left';
  }
  if (node.rect.x >= viewport.x + viewport.width) {
    return 'right';
  }
  return null;
}

function isDiscoverableOffscreenNode(node: SnapshotNode): boolean {
  if (node.hittable === true) {
    return true;
  }
  const type = (node.type ?? '').toLowerCase();
  return (
    type.includes('button') ||
    type.includes('link') ||
    type.includes('textfield') ||
    type.includes('edittext') ||
    type.includes('searchfield') ||
    type.includes('checkbox') ||
    type.includes('radio') ||
    type.includes('switch') ||
    type.includes('menuitem')
  );
}

function uniqueLabels(nodes: SnapshotNode[]): string[] {
  const labels: string[] = [];
  for (const node of nodes) {
    const label = displayNodeLabel(node);
    if (!label || labels.includes(label)) {
      continue;
    }
    labels.push(label);
  }
  return labels;
}
