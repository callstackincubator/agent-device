import type { CommandRequestResult } from '../client-types.ts';
import { readCommandMessage } from '../utils/success-text.ts';
import type { CliOutput } from './command-contract.ts';

export function batchCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const total = typeof data.total === 'number' ? data.total : 0;
  const executed = typeof data.executed === 'number' ? data.executed : 0;
  const durationMs = typeof data.totalDurationMs === 'number' ? data.totalDurationMs : undefined;
  const lines = [
    `Batch completed: ${executed}/${total} steps${durationMs !== undefined ? ` in ${durationMs}ms` : ''}`,
  ];
  const results = Array.isArray(data.results) ? data.results : [];
  for (const entry of results) {
    const line = renderBatchStepLine(entry);
    if (line) lines.push(line);
  }
  return { data, text: lines.join('\n') };
}

export function logsCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const pathOut = typeof data.path === 'string' ? data.path : '';
  return {
    data,
    text: pathOut,
    stderr: joinDefinedLines([
      formatKeyValueFields(data, ['active', 'state', 'backend', 'sizeBytes']),
      formatActionFields(data),
      typeof data.hint === 'string' ? data.hint : undefined,
      formatNotes(data.notes),
    ]),
  };
}

export function networkCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  const lines: string[] = [];
  const pathOut = typeof data.path === 'string' ? data.path : '';
  if (pathOut) lines.push(pathOut);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (entries.length === 0) {
    lines.push('No recent HTTP(s) entries found.');
  } else {
    for (const entry of entries) {
      lines.push(...formatNetworkEntry(entry));
    }
  }
  return {
    data,
    text: lines.join('\n'),
    stderr: joinDefinedLines([
      formatKeyValueFields(data, [
        'active',
        'state',
        'backend',
        'include',
        'scannedLines',
        'matchedLines',
      ]),
      formatNotes(data.notes),
    ]),
  };
}

export function perfCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  return { data, text: formatPerfCliOutput(data) };
}

function renderBatchStepLine(entry: unknown): string | undefined {
  const result = readRecord(entry);
  if (!result) return undefined;
  const step = typeof result.step === 'number' ? result.step : undefined;
  const command = typeof result.command === 'string' ? result.command : 'step';
  const stepOk = result.ok !== false;
  const description = readBatchStepDescription(result, stepOk, command);
  const prefix = step !== undefined ? `${step}. ` : '- ';
  const durationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
  const durationSuffix = durationMs !== undefined ? ` (${durationMs}ms)` : '';
  return `${prefix}${stepOk ? 'OK' : 'FAILED'} ${description}${durationSuffix}`;
}

function readBatchStepDescription(
  result: Record<string, unknown>,
  stepOk: boolean,
  command: string,
): string {
  if (stepOk) return readCommandMessage(readRecord(result.data)) ?? command;
  return readBatchStepFailure(readRecord(result.error)) ?? command;
}

function readBatchStepFailure(error: Record<string, unknown> | undefined): string | null {
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : null;
}

function formatActionFields(data: Record<string, unknown>): string | undefined {
  return (
    ['started', 'stopped', 'marked', 'cleared', 'restarted', 'removedRotatedFiles']
      .map((key) => formatActionField(key, data[key]))
      .filter(Boolean)
      .join(' ') || undefined
  );
}

function formatActionField(key: string, value: unknown): string {
  if (value === true) return `${key}=true`;
  return typeof value === 'number' ? `${key}=${value}` : '';
}

function formatNetworkEntry(entry: unknown): string[] {
  const record = readRecord(entry) ?? {};
  const method = typeof record.method === 'string' ? record.method : 'HTTP';
  const url = typeof record.url === 'string' ? record.url : '<unknown-url>';
  const status = typeof record.status === 'number' ? ` status=${record.status}` : '';
  const timestamp = typeof record.timestamp === 'string' ? `${record.timestamp} ` : '';
  const durationMs =
    typeof record.durationMs === 'number' ? ` durationMs=${record.durationMs}` : '';
  const lines = [`${timestamp}${method} ${url}${status}${durationMs}`];
  appendNetworkEntryBody(lines, 'headers', record.headers);
  appendNetworkEntryBody(lines, 'request', record.requestBody);
  appendNetworkEntryBody(lines, 'response', record.responseBody);
  return lines;
}

function appendNetworkEntryBody(lines: string[], label: string, value: unknown): void {
  if (typeof value === 'string') lines.push(`  ${label}: ${value}`);
}

function formatKeyValueFields(data: Record<string, unknown>, fields: string[]): string | undefined {
  const text = fields
    .map((key) => (data[key] !== undefined && data[key] !== null ? `${key}=${data[key]}` : ''))
    .filter(Boolean)
    .join(' ');
  return text || undefined;
}

function formatNotes(notes: unknown): string | undefined {
  if (!Array.isArray(notes)) return undefined;
  const lines = notes.filter((note): note is string => typeof note === 'string' && note.length > 0);
  return lines.length > 0 ? lines.join('\n') : undefined;
}

function joinDefinedLines(lines: Array<string | undefined>): string | undefined {
  const joined = lines.filter((line): line is string => Boolean(line)).join('\n');
  return joined || undefined;
}

function formatPerfCliOutput(data: Record<string, unknown>): string {
  const nativeOutput = formatNativePerfOutput(data);
  if (nativeOutput) return nativeOutput;
  const artifact = readRecord(data.artifact);
  if (artifact) {
    return formatMemoryArtifactSummary(artifact);
  }
  const metrics = readRecord(data.metrics);
  const fps = readRecord(metrics?.fps);
  const resourceSummary = buildResourcePerfSummary(metrics);
  if (!fps) {
    return formatPerfUnavailable(resourceSummary, 'missing frame metric');
  }

  if (fps.available === false) {
    return formatPerfUnavailable(resourceSummary, readUnavailableReason(fps));
  }

  const frameSummary = formatFrameHealthSummary(fps);
  if (!frameSummary) return formatPerfUnavailable(resourceSummary, 'missing dropped-frame summary');

  const lines = [`Frame health: ${frameSummary}`];
  const worstWindows = formatWorstFrameWindows(fps);
  if (worstWindows.length > 0) {
    lines.push('Worst windows:', ...worstWindows);
  }
  return lines.join('\n');
}

function formatMemoryArtifactSummary(artifact: Record<string, unknown>): string {
  const kind = typeof artifact.kind === 'string' ? artifact.kind : 'memory';
  if (artifact.available === false) {
    const reason =
      typeof artifact.reason === 'string' && artifact.reason.length > 0
        ? artifact.reason
        : 'not available';
    return `Memory artifact (${kind}): unavailable - ${reason}`;
  }
  const artifactPath = typeof artifact.path === 'string' ? artifact.path : undefined;
  const sizeBytes = readFiniteNumber(artifact.sizeBytes);
  const sizeText = sizeBytes === undefined ? '' : ` (${formatBytes(sizeBytes)})`;
  return artifactPath
    ? `Memory artifact (${kind}): ${artifactPath}${sizeText}`
    : `Memory artifact (${kind}): captured${sizeText}`;
}

function formatNativePerfOutput(data: Record<string, unknown>): string | undefined {
  const state = typeof data.perf === 'string' ? data.perf : undefined;
  const outPath = readNativePerfArtifactPath(data);
  if (!state || !outPath || data.kind !== 'xctrace') return undefined;
  const mode = typeof data.mode === 'string' ? data.mode : 'capture';
  return formatNativePerfLines(outPath, mode, state, data.template);
}

function readNativePerfArtifactPath(data: Record<string, unknown>): string | undefined {
  if (typeof data.outPath === 'string') return data.outPath;
  return typeof data.reportPath === 'string' ? data.reportPath : undefined;
}

function formatNativePerfLines(
  outPath: string,
  mode: string,
  state: string,
  template: unknown,
): string {
  const lines = [outPath, `Perf ${mode}: ${state}`];
  if (typeof template === 'string') lines.push(`Template: ${template}`);
  return lines.join('\n');
}

function formatPerfUnavailable(resourceSummary: string | undefined, reason: string): string {
  return resourceSummary
    ? `Performance: ${resourceSummary}`
    : `Frame health: unavailable - ${reason}`;
}

function readUnavailableReason(fps: Record<string, unknown>): string {
  return typeof fps.reason === 'string' && fps.reason.length > 0 ? fps.reason : 'not available';
}

function formatFrameHealthSummary(fps: Record<string, unknown>): string | undefined {
  const droppedFramePercent = readFiniteNumber(fps.droppedFramePercent);
  const droppedFrameCount = readFiniteNumber(fps.droppedFrameCount);
  if (droppedFramePercent === undefined || droppedFrameCount === undefined) return undefined;
  return [
    `dropped ${formatPercent(droppedFramePercent)}`,
    formatDroppedFrameCount(droppedFrameCount, readFiniteNumber(fps.totalFrameCount)),
    formatSampleWindow(readFiniteNumber(fps.sampleWindowMs)),
  ]
    .filter(Boolean)
    .join(' ');
}

function formatDroppedFrameCount(droppedFrameCount: number, totalFrameCount?: number): string {
  return totalFrameCount !== undefined
    ? `(${Math.round(droppedFrameCount)}/${Math.round(totalFrameCount)} frames)`
    : `(${Math.round(droppedFrameCount)} dropped frames)`;
}

function formatSampleWindow(sampleWindowMs: number | undefined): string {
  return sampleWindowMs !== undefined ? `window ${formatDurationMs(sampleWindowMs)}` : '';
}

function formatWorstFrameWindows(fps: Record<string, unknown>): string[] {
  return readRecordArray(fps.worstWindows).flatMap((window) => {
    const line = formatWorstFrameWindow(window);
    return line ? [line] : [];
  });
}

function formatWorstFrameWindow(window: Record<string, unknown>): string | undefined {
  const startOffsetMs = readFiniteNumber(window.startOffsetMs);
  const endOffsetMs = readFiniteNumber(window.endOffsetMs);
  const count = readFiniteNumber(window.missedDeadlineFrameCount);
  if (startOffsetMs === undefined || endOffsetMs === undefined || count === undefined) {
    return undefined;
  }
  const worstFrameMs = readFiniteNumber(window.worstFrameMs);
  const worstFrameText =
    worstFrameMs === undefined ? '' : `, worst ${formatDurationMs(worstFrameMs)}`;
  return `- +${formatDurationMs(startOffsetMs)}-+${formatDurationMs(endOffsetMs)}: ${Math.round(count)} missed-deadline frames${worstFrameText}`;
}

function buildResourcePerfSummary(
  metrics: Record<string, unknown> | undefined,
): string | undefined {
  const parts = [
    formatCpuPerfSummary(readRecord(metrics?.cpu)),
    formatMemoryPerfSummary(readRecord(metrics?.memory)),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function formatCpuPerfSummary(cpu: Record<string, unknown> | undefined): string | undefined {
  if (cpu?.available !== true) return undefined;
  const usagePercent = readFiniteNumber(cpu.usagePercent);
  return usagePercent !== undefined ? `CPU ${formatPercent(usagePercent)}` : undefined;
}

function formatMemoryPerfSummary(memory: Record<string, unknown> | undefined): string | undefined {
  if (memory?.available !== true) return undefined;
  const memoryKb =
    readFiniteNumber(memory.residentMemoryKb) ??
    readFiniteNumber(memory.totalPssKb) ??
    readFiniteNumber(memory.totalRssKb);
  return memoryKb !== undefined ? `memory ${formatMemoryKb(memoryKb)}` : undefined;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is Record<string, unknown> =>
          Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
      )
    : [];
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function formatDurationMs(value: number): string {
  const roundedMs = Math.max(0, Math.round(value));
  if (roundedMs < 1000) return `${roundedMs}ms`;
  const seconds = Math.round(roundedMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

function formatMemoryKb(value: number): string {
  const megabytes = value / 1024;
  return `${megabytes >= 10 ? Math.round(megabytes) : megabytes.toFixed(1)}MB`;
}

function formatBytes(value: number): string {
  const megabytes = value / 1024 / 1024;
  if (megabytes >= 10) return `${Math.round(megabytes)}MB`;
  if (megabytes >= 1) return `${megabytes.toFixed(1)}MB`;
  return `${Math.max(1, Math.round(value / 1024))}KB`;
}
