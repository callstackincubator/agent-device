import type { CommandRequestResult, DebugSymbolsResult } from '../../client-types.ts';
import type { CliOutput } from '../command-contract.ts';
import {
  readRecord,
  readRecordArray,
  resultOutput,
  type CliOutputFormatter,
} from '../output-common.ts';

function logsCliOutput(result: CommandRequestResult): CliOutput {
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

function networkCliOutput(result: CommandRequestResult): CliOutput {
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

function perfCliOutput(result: CommandRequestResult): CliOutput {
  const data = result as Record<string, unknown>;
  return { data, text: formatPerfCliOutput(data) };
}

function debugSymbolsCliOutput(result: DebugSymbolsResult): CliOutput {
  const lines = [result.outPath, result.message];
  lines.push(...formatDebugCrashSummary(result));
  for (const image of result.matchedImages) {
    lines.push(`Matched: ${image.name} ${image.uuid}${image.arch ? ` ${image.arch}` : ''}`);
  }
  for (const warning of result.warnings ?? []) {
    lines.push(`Warning: ${warning}`);
  }
  return { data: result, text: lines.join('\n') };
}

export const observabilityCliOutputFormatters = {
  perf: resultOutput(perfCliOutput),
  logs: resultOutput(logsCliOutput),
  network: resultOutput(networkCliOutput),
  debug: resultOutput(debugSymbolsCliOutput),
} as const satisfies Record<string, CliOutputFormatter>;

function formatDebugCrashSummary(result: DebugSymbolsResult): string[] {
  const crash = result.crash;
  const lines = [
    `Crash: ${crash.appName ?? 'unknown app'}${crash.crashedThread === undefined ? '' : ` thread ${crash.crashedThread}`}`,
  ];
  if (crash.bundleId) lines.push(`Bundle: ${crash.bundleId}`);
  if (crash.exceptionType) lines.push(`Exception: ${crash.exceptionType}`);
  if (crash.terminationReason) lines.push(`Termination: ${crash.terminationReason}`);
  for (const frame of crash.topFrames) {
    lines.push(`Frame ${frame.index}: ${frame.image} ${frame.symbol ?? frame.address}`);
  }
  for (const finding of crash.findings) {
    lines.push(`Finding: ${finding}`);
  }
  return lines;
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
  if (data.kind === 'xctrace') return formatAppleNativePerfOutput(data);
  return formatAndroidNativePerfOutput(data);
}

function formatAppleNativePerfOutput(data: Record<string, unknown>): string | undefined {
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

function formatAndroidNativePerfOutput(data: Record<string, unknown>): string | undefined {
  const summary = readNativePerfSummary(data);
  if (!summary) return undefined;
  return `Perf ${summary.action}: ${summary.kind} ${summary.type}${formatNativePerfState(
    data,
  )}${formatNativePerfArtifact(data)}${formatNativePerfFrameHealth(data)}`;
}

function readNativePerfSummary(
  data: Record<string, unknown>,
): { action: string; kind: string; type: string } | undefined {
  const action = readString(data.action);
  const kind = readString(data.kind);
  const type = readString(data.type);
  return action && kind && type ? { action, kind, type } : undefined;
}

function formatNativePerfState(data: Record<string, unknown>): string {
  const state = readString(data.state);
  return state ? ` state=${state}` : '';
}

function formatNativePerfArtifact(data: Record<string, unknown>): string {
  const outPath = readString(data.outPath);
  if (!outPath) return '';
  const sizeBytes = readFiniteNumber(data.sizeBytes);
  return `\n${outPath}${sizeBytes !== undefined ? ` (${formatBytes(sizeBytes)})` : ''}`;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function formatNativePerfFrameHealth(data: Record<string, unknown>): string {
  const summary = readRecord(data.summary);
  const frameHealth = readRecord(summary?.frameHealth);
  if (!frameHealth || frameHealth.available !== true) return '';
  const droppedFramePercent = readFiniteNumber(frameHealth.droppedFramePercent);
  const droppedFrameCount = readFiniteNumber(frameHealth.droppedFrameCount);
  const totalFrameCount = readFiniteNumber(frameHealth.totalFrameCount);
  if (
    droppedFramePercent === undefined ||
    droppedFrameCount === undefined ||
    totalFrameCount === undefined
  ) {
    return '';
  }
  return `\nTrace frame health: dropped ${formatPercent(droppedFramePercent)} (${Math.round(
    droppedFrameCount,
  )}/${Math.round(totalFrameCount)} frames)`;
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
  if (value < 1024) return `${Math.round(value)}B`;
  const kib = value / 1024;
  if (kib < 1024) return `${kib >= 10 ? Math.round(kib) : kib.toFixed(1)}KB`;
  const mib = kib / 1024;
  return `${mib >= 10 ? Math.round(mib) : mib.toFixed(1)}MB`;
}
