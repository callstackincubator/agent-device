import { AppError, normalizeError, type NormalizedError } from './errors.ts';
import { buildSnapshotDisplayLines, formatSnapshotLine } from './snapshot-lines.ts';
import type { SnapshotNode } from './snapshot.ts';

export type JsonResult =
  | { success: true; data?: Record<string, unknown> }
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
    const flatLines = nodes.map((node) => formatSnapshotLine(node, 0, false));
    return `${prefix}${header}\n${flatLines.join('\n')}\n`;
  }
  const lines = buildSnapshotDisplayLines(nodes).map((line) => line.text);
  return `${prefix}${header}\n${lines.join('\n')}\n`;
}

export function formatSnapshotDiffText(data: Record<string, unknown>): string {
  const baselineInitialized = data.baselineInitialized === true;
  const summaryRaw = (data.summary ?? {}) as Record<string, unknown>;
  const additions = toNumber(summaryRaw.additions);
  const removals = toNumber(summaryRaw.removals);
  const unchanged = toNumber(summaryRaw.unchanged);
  if (baselineInitialized) {
    return `Baseline initialized (${unchanged} lines).\n`;
  }
  const rawLines = Array.isArray(data.lines) ? (data.lines as SnapshotDiffLine[]) : [];
  const lines = rawLines.map((line) => {
    const text = typeof line.text === 'string' ? line.text : '';
    if (line.kind === 'added') return `+${text}`;
    if (line.kind === 'removed') return `-${text}`;
    return text;
  });
  const body = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  return `${body}${additions} additions, ${removals} removals, ${unchanged} unchanged\n`;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
