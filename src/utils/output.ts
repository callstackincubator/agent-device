import path from 'node:path';
import { AppError, normalizeError, type NormalizedError } from './errors.ts';
import { buildSnapshotDisplayLines, formatSnapshotLine } from './snapshot-lines.ts';
import type { SnapshotNode, SnapshotVisibility } from './snapshot.ts';
import { displayNodeLabel } from './snapshot-tree.ts';
import type { ScreenshotDiffResult } from './screenshot-diff.ts';
import type { ScreenshotDiffRegion } from './screenshot-diff-regions.ts';
import { styleText } from 'node:util';
import { buildMobileSnapshotPresentation } from './mobile-snapshot-semantics.ts';

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
  const backend = typeof data.backend === 'string' ? data.backend : undefined;
  const visiblePresentation =
    options.raw || backend === 'macos-helper' ? null : buildMobileSnapshotPresentation(nodes);
  const truncated = Boolean(data.truncated);
  const appName = typeof data.appName === 'string' ? data.appName : undefined;
  const appBundleId = typeof data.appBundleId === 'string' ? data.appBundleId : undefined;
  const meta: string[] = [];
  if (appName) meta.push(`Page: ${appName}`);
  if (appBundleId) meta.push(`App: ${appBundleId}`);
  const displayedNodes = visiblePresentation?.nodes ?? nodes;
  const visibility =
    options.raw || backend === 'macos-helper'
      ? null
      : readSnapshotVisibility(data, visiblePresentation, displayedNodes.length, nodes.length);
  const header = visibility?.partial
    ? visibility.totalNodeCount > visibility.visibleNodeCount
      ? `Snapshot: ${visibility.visibleNodeCount} visible nodes (${visibility.totalNodeCount} total)${truncated ? ' (truncated)' : ''}`
      : `Snapshot: ${visibility.visibleNodeCount} visible nodes${truncated ? ' (truncated)' : ''}`
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
    const flatLines = buildFlattenedSnapshotDisplayLines(displayedNodes);
    const summaryBlock =
      visiblePresentation && visiblePresentation.summaryLines.length > 0
        ? `\n${visiblePresentation.summaryLines.join('\n')}`
        : '';
    return `${prefix}${header}\n${noticesBlock}${flatLines.join('\n')}${summaryBlock}\n`;
  }
  const lines = renderSnapshotDisplayLines(
    buildSnapshotDisplayLines(displayedNodes, { summarizeTextSurfaces: true }),
  );
  const summaryBlock =
    visiblePresentation && visiblePresentation.summaryLines.length > 0
      ? `\n${visiblePresentation.summaryLines.join('\n')}`
      : '';
  return `${prefix}${header}\n${noticesBlock}${lines.join('\n')}${summaryBlock}\n`;
}

function readSnapshotVisibility(
  data: Record<string, unknown>,
  visiblePresentation: ReturnType<typeof buildMobileSnapshotPresentation> | null,
  displayedNodeCount: number,
  totalNodeCount: number,
): SnapshotVisibility | null {
  const candidate = data.visibility;
  if (candidate && typeof candidate === 'object') {
    const visibility = candidate as Partial<SnapshotVisibility>;
    if (
      typeof visibility.partial === 'boolean' &&
      typeof visibility.visibleNodeCount === 'number' &&
      typeof visibility.totalNodeCount === 'number' &&
      Array.isArray(visibility.reasons)
    ) {
      return {
        partial: visibility.partial,
        visibleNodeCount: visibility.visibleNodeCount,
        totalNodeCount: visibility.totalNodeCount,
        reasons: visibility.reasons.filter(
          (reason): reason is SnapshotVisibility['reasons'][number] => typeof reason === 'string',
        ),
      };
    }
  }

  const hiddenCount = visiblePresentation?.hiddenCount ?? 0;
  const hasExplicitHiddenContentHints = visiblePresentation
    ? visiblePresentation.nodes.some((node) => node.hiddenContentAbove || node.hiddenContentBelow)
    : false;
  if (hiddenCount > 0) {
    return {
      partial: true,
      visibleNodeCount: displayedNodeCount,
      totalNodeCount,
      reasons: ['offscreen-nodes'],
    };
  }
  if (hasExplicitHiddenContentHints) {
    return {
      partial: true,
      visibleNodeCount: displayedNodeCount,
      totalNodeCount: displayedNodeCount,
      reasons: [],
    };
  }
  return null;
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

  if (data.currentOverlayPath && !match) {
    const relativePath = toRelativePath(data.currentOverlayPath);
    const label = useColor ? colorize('Current overlay:', 'dim') : 'Current overlay:';
    const displayPath = useColor ? colorize(relativePath, 'green') : relativePath;
    const refCount = toNumber(data.currentOverlayRefCount);
    const refSuffix = refCount > 0 ? ` (${refCount} refs)` : '';
    lines.push(`  ${label} ${displayPath}${refSuffix}`);
  }

  if (!match && !dimensionMismatch) {
    const diffCount = useColor ? colorize(String(differentPixels), 'red') : String(differentPixels);
    lines.push(`  ${diffCount} different / ${totalPixels} total pixels`);
  }

  const hints = !match && !dimensionMismatch ? formatScreenshotDiffHints(data) : [];
  if (hints.length > 0) {
    lines.push('  Hints:');
    for (const hint of hints) lines.push(`    - ${hint}`);
  }

  const regions = Array.isArray(data.regions) ? data.regions : [];
  if (!match && !dimensionMismatch && regions.length > 0) {
    lines.push('  Changed regions:');
    for (const region of regions.slice(0, 5)) {
      const share =
        region.shareOfDiffPercentage === 0 && region.differentPixels > 0
          ? '<0.01'
          : String(region.shareOfDiffPercentage);
      const rect = region.rect;
      lines.push(
        `    ${region.index}. ${region.location} x=${rect.x} y=${rect.y} ` +
          `${rect.width}x${rect.height}, ${share}% of diff, change=${region.dominantChange}`,
      );
      const detailLine = formatScreenshotRegionDetails(region);
      if (detailLine) {
        lines.push(`       ${detailLine}`);
      }
      const bestMatch = region.currentOverlayMatches?.[0];
      if (bestMatch) {
        const label = bestMatch.label ? ` "${bestMatch.label}"` : '';
        lines.push(
          `       overlaps @${bestMatch.ref}${label}, ` +
            `${bestMatch.regionCoveragePercentage}% of region`,
        );
      }
    }
  }

  const ocrMatches = data.ocr?.matches ?? [];
  if (!match && !dimensionMismatch && ocrMatches.length > 0) {
    const shownOcrMatches = ocrMatches.slice(0, 8);
    lines.push(
      `  OCR text deltas (${data.ocr?.provider}; baselineBlocks=${data.ocr?.baselineBlocks} ` +
        `currentBlocks=${data.ocr?.currentBlocks}; showing ${shownOcrMatches.length}/${ocrMatches.length}; px):`,
    );
    lines.push(
      '    item | text | movePx | sizeDeltaPx | bboxBaseline | bboxCurrent | confidence | issueHint',
    );
    for (const [index, ocrMatch] of shownOcrMatches.entries()) {
      const delta = ocrMatch.delta;
      lines.push(
        `    ${index + 1} | ${JSON.stringify(ocrMatch.text)} | ` +
          `${formatSignedPixels(delta.x)},${formatSignedPixels(delta.y)} | ` +
          `${formatSignedPixels(delta.width)},${formatSignedPixels(delta.height)} | ` +
          `${formatRect(ocrMatch.baselineRect)} | ${formatRect(ocrMatch.currentRect)} | ` +
          `${ocrMatch.confidence} | ` +
          `${ocrMatch.possibleTextMetricMismatch ? 'ocr-bbox-size-change' : '-'}`,
      );
    }
  }

  const nonTextDeltas = data.nonTextDeltas ?? [];
  if (!match && !dimensionMismatch && nonTextDeltas.length > 0) {
    const shownNonTextDeltas = nonTextDeltas.slice(0, 8);
    lines.push(
      `  Non-text visual deltas (showing ${shownNonTextDeltas.length}/${nonTextDeltas.length}; px):`,
    );
    lines.push('    item | region | slot | kind | bboxCurrent | nearestText');
    for (const delta of shownNonTextDeltas) {
      lines.push(
        `    ${delta.index} | ${delta.regionIndex ? `r${delta.regionIndex}` : '-'} | ` +
          `${delta.slot} | ${delta.likelyKind} | ${formatRect(delta.rect)} | ` +
          `${delta.nearestText ? JSON.stringify(delta.nearestText) : '-'}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatRect(rect: { x: number; y: number; width: number; height: number }): string {
  return `x=${rect.x},y=${rect.y},w=${rect.width},h=${rect.height}`;
}

function formatSignedPixels(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function formatScreenshotDiffHints(data: ScreenshotDiffResult): string[] {
  const hints: string[] = [];
  const clusters = data.ocr?.movementClusters ?? [];
  for (const cluster of clusters.slice(0, 2)) {
    hints.push(
      `text movement cluster: ${formatQuotedList(cluster.texts)} dx=${formatRange(cluster.xRange)}px ` +
        `dy=${formatRange(cluster.yRange)}px`,
    );
  }

  const addedText = data.ocr?.addedText ?? [];
  if (addedText.length > 0) {
    hints.push(`added text candidates: ${formatTextChanges(addedText)}`);
  }

  const removedText = data.ocr?.removedText ?? [];
  if (removedText.length > 0) {
    hints.push(`removed text candidates: ${formatTextChanges(removedText)}`);
  }

  const controlDeltas = (data.nonTextDeltas ?? [])
    .filter((delta) => ['icon', 'toggle', 'chevron', 'separator'].includes(delta.likelyKind))
    .slice(0, 3);
  if (controlDeltas.length > 0) {
    hints.push(`non-text controls/boundaries: ${controlDeltas.map(formatNonTextHint).join('; ')}`);
  }

  const largestRegion = data.regions?.[0];
  if (largestRegion) {
    hints.push(
      `largest changed region: r${largestRegion.index} ${largestRegion.location} ` +
        `${largestRegion.shareOfDiffPercentage}% of diff, ${largestRegion.dominantChange}`,
    );
  }

  return hints.slice(0, 6);
}

function formatTextChanges(
  changes: Array<{ text: string; rect: { x: number; y: number; width: number; height: number } }>,
): string {
  return changes
    .slice(0, 3)
    .map((change) => `${JSON.stringify(change.text)} at x=${change.rect.x},y=${change.rect.y}`)
    .join(', ');
}

function formatNonTextHint(delta: {
  likelyKind: string;
  nearestText?: string;
  regionIndex?: number;
}): string {
  const anchor = delta.nearestText ? ` near ${JSON.stringify(delta.nearestText)}` : '';
  const region = delta.regionIndex ? ` r${delta.regionIndex}` : '';
  return `${delta.likelyKind}${anchor}${region}`;
}

function formatRange(range: { min: number; max: number }): string {
  return range.min === range.max
    ? formatSignedPixels(range.min)
    : `${formatSignedPixels(range.min)}..${formatSignedPixels(range.max)}`;
}

function formatQuotedList(values: string[]): string {
  const shown = values.slice(0, 4).map((value) => JSON.stringify(value));
  const suffix = values.length > shown.length ? ` +${values.length - shown.length} more` : '';
  return `${shown.join(', ')}${suffix}`;
}

function formatScreenshotRegionDetails(region: ScreenshotDiffRegion): string | null {
  const details = [
    region.size ? `size=${region.size}` : null,
    region.shape ? `shape=${region.shape}` : null,
    typeof region.densityPercentage === 'number' ? `density=${region.densityPercentage}%` : null,
    region.averageBaselineColorHex && region.averageCurrentColorHex
      ? `avgColor=${region.averageBaselineColorHex}->${region.averageCurrentColorHex}`
      : null,
    typeof region.baselineLuminance === 'number' && typeof region.currentLuminance === 'number'
      ? `luminance=${region.baselineLuminance}->${region.currentLuminance}`
      : null,
  ].filter((entry): entry is string => entry !== null);
  return details.length > 0 ? details.join(' ') : null;
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

// Detects likely duplicated navigation chrome (e.g. bottom tab bars rendered once
// per tab).  Thresholds: ≥20 total nodes to avoid false positives on tiny trees,
// and ≥8 cumulative duplicate-signature nodes to surface the warning.
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

function renderSnapshotDisplayLines(lines: ReturnType<typeof buildSnapshotDisplayLines>): string[] {
  return lines.flatMap((line) => [line.text, ...readHiddenContentHintLines(line)]);
}

function buildFlattenedSnapshotDisplayLines(nodes: SnapshotNode[]): string[] {
  return buildSnapshotDisplayLines(nodes, { summarizeTextSurfaces: true }).flatMap((line) => [
    formatSnapshotLine(line.node, 0, false, line.type, { summarizeTextSurfaces: true }),
    ...readHiddenContentHintLines({ ...line, depth: 0 }),
  ]);
}

function readHiddenContentHintLines(
  line: ReturnType<typeof buildSnapshotDisplayLines>[number],
): string[] {
  const target = hintTargetLabel(line.type);
  if (!target) {
    return [];
  }
  const hints: string[] = [];
  if (line.node.hiddenContentAbove) {
    hints.push(`[content above ${target} hidden]`);
  }
  if (line.node.hiddenContentBelow) {
    hints.push(`[content below ${target} hidden]`);
  }
  if (hints.length === 0) {
    return [];
  }
  const indent = '  '.repeat(line.depth + 1);
  return hints.map((hint) => `${indent}${hint}`);
}

function hintTargetLabel(type: string): string | null {
  if (type === 'scroll-area' || type === 'list' || type === 'collection' || type === 'table') {
    return type;
  }
  return null;
}
