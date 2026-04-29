import type { CliFlags } from '../../utils/command-schema.ts';
import { CLIENT_COMMANDS } from '../../client-command-registry.ts';
import { readCommandMessage } from '../../utils/success-text.ts';
import { printJson } from '../../utils/output.ts';
import { renderReplayTestResponse } from '../../cli-test.ts';
import type { ReplaySuiteResult } from '../../daemon/types.ts';

type CliOutputFlags = Pick<CliFlags, 'json' | 'verbose' | 'reportJunit'>;
type TextOutputHandler = (options: {
  positionals: string[];
  flags: CliOutputFlags;
  data: Record<string, unknown>;
}) => boolean;

function renderBatchSummary(data: Record<string, unknown>): void {
  const total = typeof data.total === 'number' ? data.total : 0;
  const executed = typeof data.executed === 'number' ? data.executed : 0;
  const durationMs = typeof data.totalDurationMs === 'number' ? data.totalDurationMs : undefined;
  process.stdout.write(
    `Batch completed: ${executed}/${total} steps${durationMs !== undefined ? ` in ${durationMs}ms` : ''}\n`,
  );
  const results = Array.isArray(data.results) ? data.results : [];
  for (const entry of results) {
    const line = renderBatchStepLine(entry);
    if (line) process.stdout.write(line);
  }
}

function renderBatchStepLine(entry: unknown): string | undefined {
  const result = readRecord(entry);
  if (!result) return undefined;
  const step = typeof result.step === 'number' ? result.step : undefined;
  const command = typeof result.command === 'string' ? result.command : 'step';
  const stepOk = result.ok !== false;
  const stepData = readRecord(result.data);
  const stepError = readRecord(result.error);
  const description = stepOk
    ? (readCommandMessage(stepData) ?? command)
    : (readBatchStepFailure(stepError) ?? command);
  const prefix = step !== undefined ? `${step}. ` : '- ';
  const durationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
  const durationSuffix = durationMs !== undefined ? ` (${durationMs}ms)` : '';
  return `${prefix}${stepOk ? 'OK' : 'FAILED'} ${description}${durationSuffix}\n`;
}

export function writeCommandCliOutput(
  command: string,
  positionals: string[],
  flags: CliOutputFlags,
  data: Record<string, unknown>,
): number {
  if (flags.json) {
    return writeJsonCliOutput(command, flags, data);
  }

  if (command === CLIENT_COMMANDS.test) {
    return renderReplayTestResponse({
      suite: data as ReplaySuiteResult,
      verbose: flags.verbose,
      reportJunit: flags.reportJunit,
    });
  }

  const handler = TEXT_OUTPUT_HANDLERS[command];
  if (handler?.({ positionals, flags, data })) {
    return 0;
  }

  const successText = readCommandMessage(data);
  if (successText) {
    process.stdout.write(`${successText}\n`);
  }
  return 0;
}

function writeJsonCliOutput(
  command: string,
  flags: CliOutputFlags,
  data: Record<string, unknown>,
): number {
  if (command === CLIENT_COMMANDS.test) {
    return renderReplayTestResponse({
      suite: data as ReplaySuiteResult,
      json: true,
      reportJunit: flags.reportJunit,
    });
  }
  printJson({ success: true, data });
  return 0;
}

const TEXT_OUTPUT_HANDLERS: Partial<Record<string, TextOutputHandler>> = {
  [CLIENT_COMMANDS.batch]: ({ data }) => {
    renderBatchSummary(data);
    return true;
  },
  [CLIENT_COMMANDS.get]: ({ positionals, data }) => writeGetCliOutput(positionals, data),
  [CLIENT_COMMANDS.find]: ({ data }) => writeFindCliOutput(data),
  [CLIENT_COMMANDS.is]: ({ data }) => {
    process.stdout.write(`Passed: is ${data.predicate ?? 'assertion'}\n`);
    return true;
  },
  [CLIENT_COMMANDS.boot]: ({ data }) => {
    const platform = data.platform ?? 'unknown';
    const device = data.device ?? data.id ?? 'unknown';
    process.stdout.write(`Boot ready: ${device} (${platform})\n`);
    return true;
  },
  [CLIENT_COMMANDS.record]: ({ data }) => {
    const outPath = typeof data.outPath === 'string' ? data.outPath : '';
    if (outPath) process.stdout.write(`${outPath}\n`);
    return true;
  },
  [CLIENT_COMMANDS.logs]: ({ data, flags }) => {
    writeLogsCliOutput(data, flags);
    return true;
  },
  [CLIENT_COMMANDS.network]: ({ data }) => {
    writeNetworkCliOutput(data);
    return true;
  },
  [CLIENT_COMMANDS.click]: ({ data }) => writeTapCliOutput(data),
  [CLIENT_COMMANDS.press]: ({ data }) => writeTapCliOutput(data),
  [CLIENT_COMMANDS.perf]: ({ data }) => {
    writePerfCliOutput(data);
    return true;
  },
};

function writeGetCliOutput(positionals: string[], data: Record<string, unknown>): boolean {
  const sub = positionals[0];
  if (sub === 'text') {
    process.stdout.write(`${typeof data.text === 'string' ? data.text : ''}\n`);
    return true;
  }
  if (sub === 'attrs') {
    process.stdout.write(`${JSON.stringify(data.node ?? {}, null, 2)}\n`);
    return true;
  }
  return false;
}

function writeFindCliOutput(data: Record<string, unknown>): boolean {
  if (typeof data.text === 'string') {
    process.stdout.write(`${data.text}\n`);
    return true;
  }
  if (typeof data.found === 'boolean') {
    process.stdout.write(`Found: ${data.found}\n`);
    return true;
  }
  if (!data.node) return false;
  process.stdout.write(`${JSON.stringify(data.node, null, 2)}\n`);
  return true;
}

function writeTapCliOutput(data: Record<string, unknown>): boolean {
  const ref = data.ref ?? '';
  const x = data.x;
  const y = data.y;
  if (!ref || typeof x !== 'number' || typeof y !== 'number') return false;
  process.stdout.write(`Tapped @${ref} (${x}, ${y})\n`);
  return true;
}

function writePerfCliOutput(data: Record<string, unknown>): void {
  const metrics = readRecord(data.metrics);
  const fps = readRecord(metrics?.fps);
  const resourceSummary = buildResourcePerfSummary(metrics);
  if (!fps) {
    process.stdout.write(
      resourceSummary
        ? `Performance: ${resourceSummary}\n`
        : 'Frame health: unavailable - missing frame metric\n',
    );
    return;
  }

  if (fps.available === false) {
    if (resourceSummary) {
      process.stdout.write(`Performance: ${resourceSummary}\n`);
      return;
    }
    const reason =
      typeof fps.reason === 'string' && fps.reason.length > 0 ? fps.reason : 'not available';
    process.stdout.write(`Frame health: unavailable - ${reason}\n`);
    return;
  }

  const droppedFramePercent = readFiniteNumber(fps.droppedFramePercent);
  const droppedFrameCount = readFiniteNumber(fps.droppedFrameCount);
  const totalFrameCount = readFiniteNumber(fps.totalFrameCount);
  if (droppedFramePercent === undefined || droppedFrameCount === undefined) {
    process.stdout.write(
      resourceSummary
        ? `Performance: ${resourceSummary}\n`
        : 'Frame health: unavailable - missing dropped-frame summary\n',
    );
    return;
  }

  const parts = [`dropped ${formatPercent(droppedFramePercent)}`];
  if (totalFrameCount !== undefined) {
    parts.push(`(${Math.round(droppedFrameCount)}/${Math.round(totalFrameCount)} frames)`);
  } else {
    parts.push(`(${Math.round(droppedFrameCount)} dropped frames)`);
  }

  const sampleWindowMs = readFiniteNumber(fps.sampleWindowMs);
  if (sampleWindowMs !== undefined) {
    parts.push(`window ${formatDurationMs(sampleWindowMs)}`);
  }

  process.stdout.write(`Frame health: ${parts.join(' ')}\n`);
  writeWorstFrameWindows(fps);
}

function writeWorstFrameWindows(fps: Record<string, unknown>): void {
  const worstWindows = readRecordArray(fps.worstWindows);
  if (worstWindows.length === 0) return;
  process.stdout.write('Worst windows:\n');
  for (const window of worstWindows) {
    const line = formatWorstFrameWindow(window);
    if (line) process.stdout.write(line);
  }
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
  return `- +${formatDurationMs(startOffsetMs)}-+${formatDurationMs(endOffsetMs)}: ${Math.round(count)} missed-deadline frames${worstFrameText}\n`;
}

function buildResourcePerfSummary(
  metrics: Record<string, unknown> | undefined,
): string | undefined {
  const parts: string[] = [];
  const cpu = readRecord(metrics?.cpu);
  if (cpu?.available === true) {
    const usagePercent = readFiniteNumber(cpu.usagePercent);
    if (usagePercent !== undefined) parts.push(`CPU ${formatPercent(usagePercent)}`);
  }

  const memory = readRecord(metrics?.memory);
  if (memory?.available === true) {
    const memoryKb =
      readFiniteNumber(memory.residentMemoryKb) ??
      readFiniteNumber(memory.totalPssKb) ??
      readFiniteNumber(memory.totalRssKb);
    if (memoryKb !== undefined) parts.push(`memory ${formatMemoryKb(memoryKb)}`);
  }

  return parts.length > 0 ? parts.join(', ') : undefined;
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

function readBatchStepFailure(error: Record<string, unknown> | undefined): string | null {
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : null;
}

function writeLogsCliOutput(data: Record<string, unknown>, flags: { json?: boolean }): void {
  const pathOut = typeof data.path === 'string' ? data.path : '';
  if (!pathOut) return;
  process.stdout.write(`${pathOut}\n`);
  const meta = formatKeyValueFields(data, ['active', 'state', 'backend', 'sizeBytes']);
  if (meta && !flags.json) process.stderr.write(`${meta}\n`);
  const actionMeta = formatActionFields(data);
  if (actionMeta && !flags.json) process.stderr.write(`${actionMeta}\n`);
  if (data.hint && !flags.json) process.stderr.write(`${data.hint}\n`);
  if (!flags.json) writeNotes(data.notes);
}

function formatActionFields(data: Record<string, unknown>): string {
  return ['started', 'stopped', 'marked', 'cleared', 'restarted', 'removedRotatedFiles']
    .map((key) => formatActionField(key, data[key]))
    .filter(Boolean)
    .join(' ');
}

function formatActionField(key: string, value: unknown): string {
  if (value === true) return `${key}=true`;
  return typeof value === 'number' ? `${key}=${value}` : '';
}

function writeNetworkCliOutput(data: Record<string, unknown>): void {
  const pathOut = typeof data.path === 'string' ? data.path : '';
  if (pathOut) process.stdout.write(`${pathOut}\n`);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (entries.length === 0) {
    process.stdout.write('No recent HTTP(s) entries found.\n');
  } else {
    for (const entry of entries as Array<Record<string, unknown>>) {
      writeNetworkEntry(entry);
    }
  }
  const meta = formatKeyValueFields(data, [
    'active',
    'state',
    'backend',
    'include',
    'scannedLines',
    'matchedLines',
  ]);
  if (meta) process.stderr.write(`${meta}\n`);
  writeNotes(data.notes);
}

function writeNetworkEntry(entry: Record<string, unknown>): void {
  const method = typeof entry.method === 'string' ? entry.method : 'HTTP';
  const url = typeof entry.url === 'string' ? entry.url : '<unknown-url>';
  const status = typeof entry.status === 'number' ? ` status=${entry.status}` : '';
  const timestamp = typeof entry.timestamp === 'string' ? `${entry.timestamp} ` : '';
  const durationMs = typeof entry.durationMs === 'number' ? ` durationMs=${entry.durationMs}` : '';
  process.stdout.write(`${timestamp}${method} ${url}${status}${durationMs}\n`);
  writeNetworkEntryBody('headers', entry.headers);
  writeNetworkEntryBody('request', entry.requestBody);
  writeNetworkEntryBody('response', entry.responseBody);
}

function writeNetworkEntryBody(label: string, value: unknown): void {
  if (typeof value === 'string') process.stdout.write(`  ${label}: ${value}\n`);
}

function formatKeyValueFields(data: Record<string, unknown>, fields: string[]): string {
  return fields
    .map((key) => (data[key] !== undefined && data[key] !== null ? `${key}=${data[key]}` : ''))
    .filter(Boolean)
    .join(' ');
}

function writeNotes(notes: unknown): void {
  if (!Array.isArray(notes)) return;
  for (const note of notes) {
    if (typeof note === 'string' && note.length > 0) process.stderr.write(`${note}\n`);
  }
}
