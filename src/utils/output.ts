import path from 'node:path';
import { AppError, normalizeError, type NormalizedError } from './errors.ts';
import { buildSnapshotDisplayLines, formatSnapshotLine } from './snapshot-lines.ts';
import type { SnapshotNode } from './snapshot.ts';
import type { ScreenshotDiffResult } from './screenshot-diff.ts';
import { styleText } from 'node:util';

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

export function describeCommandSuccess(
  command: string,
  data: Record<string, unknown> | undefined,
): string | null {
  switch (command) {
    case 'open': {
      const target = firstString(data?.appName, data?.appBundleId, data?.app, data?.session);
      return target ? `Opened: ${target}` : 'Opened';
    }
    case 'close': {
      const target = firstString(data?.session);
      return target ? `Closed: ${target}` : 'Closed';
    }
    case 'click':
    case 'press': {
      const ref = firstString(data?.ref);
      const x = typeof data?.x === 'number' ? data.x : undefined;
      const y = typeof data?.y === 'number' ? data.y : undefined;
      if (ref && x !== undefined && y !== undefined) return `Tapped @${ref} (${x}, ${y})`;
      if (x !== undefined && y !== undefined) return `Tapped (${x}, ${y})`;
      return 'Tapped';
    }
    case 'fill': {
      const text = firstString(data?.text);
      return text ? `Filled ${Array.from(text).length} chars` : 'Filled';
    }
    case 'type': {
      const text = firstString(data?.text);
      return text ? `Typed ${Array.from(text).length} chars` : 'Typed';
    }
    case 'scroll': {
      const direction = firstString(data?.direction);
      return direction ? `Scrolled ${direction}` : 'Scrolled';
    }
    case 'back':
      return 'Back';
    case 'home':
      return 'Home';
    case 'app-switcher':
      return 'Opened app switcher';
    default:
      return null;
  }
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
  const truncated = Boolean(data.truncated);
  const appName = typeof data.appName === 'string' ? data.appName : undefined;
  const appBundleId = typeof data.appBundleId === 'string' ? data.appBundleId : undefined;
  const meta: string[] = [];
  if (appName) meta.push(`Page: ${appName}`);
  if (appBundleId) meta.push(`App: ${appBundleId}`);
  const header = `Snapshot: ${nodes.length} nodes${truncated ? ' (truncated)' : ''}`;
  const prefix = meta.length > 0 ? `${meta.join('\n')}\n` : '';
  if (nodes.length === 0) {
    return `${prefix}${header}\n`;
  }
  if (options.raw) {
    const rawLines = nodes.map((node) => JSON.stringify(node));
    return `${prefix}${header}\n${rawLines.join('\n')}\n`;
  }
  if (options.flatten) {
    const flatLines = nodes.map((node) =>
      formatSnapshotLine(node, 0, false, undefined, { summarizeTextSurfaces: true }),
    );
    return `${prefix}${header}\n${flatLines.join('\n')}\n`;
  }
  const lines = buildSnapshotDisplayLines(nodes, { summarizeTextSurfaces: true }).map(
    (line) => line.text,
  );
  return `${prefix}${header}\n${lines.join('\n')}\n`;
}

export function formatSnapshotDiffText(data: Record<string, unknown>): string {
  const baselineInitialized = data.baselineInitialized === true;
  const summaryRaw = (data.summary ?? {}) as Record<string, unknown>;
  const additions = toNumber(summaryRaw.additions);
  const removals = toNumber(summaryRaw.removals);
  const unchanged = toNumber(summaryRaw.unchanged);
  const useColor = supportsColor();
  if (baselineInitialized) {
    return `Baseline initialized (${unchanged} lines).\n`;
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
    return `${body}${additions} additions, ${removals} removals, ${unchanged} unchanged\n`;
  }
  const summary = [
    `${colorize(String(additions), 'green')} additions`,
    `${colorize(String(removals), 'red')} removals`,
    `${colorize(String(unchanged), 'dim')} unchanged`,
  ].join(', ');
  return `${body}${summary}\n`;
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

function colorize(text: string, format: Parameters<typeof styleText>[0]): string {
  return styleText(format, text);
}
