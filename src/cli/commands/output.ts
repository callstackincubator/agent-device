import type { CliFlags } from '../../utils/command-schema.ts';
import { CLIENT_COMMANDS } from '../../client-command-registry.ts';
import { readCommandMessage } from '../../utils/success-text.ts';
import { printJson } from '../../utils/output.ts';
import { renderReplayTestResponse } from '../../cli-test.ts';
import type { ReplaySuiteResult } from '../../daemon/types.ts';

export function renderBatchSummary(data: Record<string, unknown>): void {
  const total = typeof data.total === 'number' ? data.total : 0;
  const executed = typeof data.executed === 'number' ? data.executed : 0;
  const durationMs = typeof data.totalDurationMs === 'number' ? data.totalDurationMs : undefined;
  process.stdout.write(
    `Batch completed: ${executed}/${total} steps${durationMs !== undefined ? ` in ${durationMs}ms` : ''}\n`,
  );
  const results = Array.isArray(data.results) ? data.results : [];
  for (const entry of results) {
    if (!entry || typeof entry !== 'object') continue;
    const result = entry as Record<string, unknown>;
    const step = typeof result.step === 'number' ? result.step : undefined;
    const command = typeof result.command === 'string' ? result.command : 'step';
    const stepOk = result.ok !== false;
    const stepDurationMs = typeof result.durationMs === 'number' ? result.durationMs : undefined;
    const stepData =
      result.data && typeof result.data === 'object'
        ? (result.data as Record<string, unknown>)
        : undefined;
    const stepError =
      result.error && typeof result.error === 'object'
        ? (result.error as Record<string, unknown>)
        : undefined;
    const description = stepOk
      ? (readCommandMessage(stepData) ?? command)
      : (readBatchStepFailure(stepError) ?? command);
    const prefix = step !== undefined ? `${step}. ` : '- ';
    const durationSuffix = stepDurationMs !== undefined ? ` (${stepDurationMs}ms)` : '';
    process.stdout.write(`${prefix}${stepOk ? 'OK' : 'FAILED'} ${description}${durationSuffix}\n`);
  }
}

export function writeCommandCliOutput(
  command: string,
  positionals: string[],
  flags: Pick<CliFlags, 'json' | 'verbose' | 'reportJunit'>,
  data: Record<string, unknown>,
): number {
  if (flags.json) {
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

  if (command === CLIENT_COMMANDS.test) {
    return renderReplayTestResponse({
      suite: data as ReplaySuiteResult,
      verbose: flags.verbose,
      reportJunit: flags.reportJunit,
    });
  }
  if (command === CLIENT_COMMANDS.batch) {
    renderBatchSummary(data);
    return 0;
  }
  if (command === CLIENT_COMMANDS.get) {
    const sub = positionals[0];
    if (sub === 'text') {
      process.stdout.write(`${typeof data.text === 'string' ? data.text : ''}\n`);
      return 0;
    }
    if (sub === 'attrs') {
      process.stdout.write(`${JSON.stringify(data.node ?? {}, null, 2)}\n`);
      return 0;
    }
  }
  if (command === CLIENT_COMMANDS.find) {
    if (typeof data.text === 'string') {
      process.stdout.write(`${data.text}\n`);
      return 0;
    }
    if (typeof data.found === 'boolean') {
      process.stdout.write(`Found: ${data.found}\n`);
      return 0;
    }
    if (data.node) {
      process.stdout.write(`${JSON.stringify(data.node, null, 2)}\n`);
      return 0;
    }
  }
  if (command === CLIENT_COMMANDS.is) {
    process.stdout.write(`Passed: is ${data.predicate ?? 'assertion'}\n`);
    return 0;
  }
  if (command === CLIENT_COMMANDS.boot) {
    const platform = data.platform ?? 'unknown';
    const device = data.device ?? data.id ?? 'unknown';
    process.stdout.write(`Boot ready: ${device} (${platform})\n`);
    return 0;
  }
  if (command === CLIENT_COMMANDS.record) {
    const outPath = typeof data.outPath === 'string' ? data.outPath : '';
    if (outPath) process.stdout.write(`${outPath}\n`);
    return 0;
  }
  if (command === CLIENT_COMMANDS.logs) {
    writeLogsCliOutput(data, flags);
    return 0;
  }
  if (command === CLIENT_COMMANDS.network) {
    writeNetworkCliOutput(data);
    return 0;
  }
  if (command === CLIENT_COMMANDS.click || command === CLIENT_COMMANDS.press) {
    const ref = data.ref ?? '';
    const x = data.x;
    const y = data.y;
    if (ref && typeof x === 'number' && typeof y === 'number') {
      process.stdout.write(`Tapped @${ref} (${x}, ${y})\n`);
      return 0;
    }
  }
  if (command === CLIENT_COMMANDS.perf) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return 0;
  }
  const successText = readCommandMessage(data);
  if (successText) {
    process.stdout.write(`${successText}\n`);
  }
  return 0;
}

function readBatchStepFailure(error: Record<string, unknown> | undefined): string | null {
  return typeof error?.message === 'string' && error.message.length > 0 ? error.message : null;
}

function writeLogsCliOutput(data: Record<string, unknown>, flags: { json?: boolean }): void {
  const pathOut = typeof data.path === 'string' ? data.path : '';
  if (!pathOut) return;
  process.stdout.write(`${pathOut}\n`);
  const metaFields = ['active', 'state', 'backend', 'sizeBytes'] as const;
  const meta = metaFields
    .map((key) => (data[key] !== undefined && data[key] !== null ? `${key}=${data[key]}` : ''))
    .filter(Boolean)
    .join(' ');
  if (meta && !flags.json) process.stderr.write(`${meta}\n`);
  const actionFields = [
    'started',
    'stopped',
    'marked',
    'cleared',
    'restarted',
    'removedRotatedFiles',
  ] as const;
  const actionMeta = actionFields
    .map((key) => {
      const value = data[key];
      return value === true ? `${key}=true` : typeof value === 'number' ? `${key}=${value}` : '';
    })
    .filter(Boolean)
    .join(' ');
  if (actionMeta && !flags.json) process.stderr.write(`${actionMeta}\n`);
  if (data.hint && !flags.json) process.stderr.write(`${data.hint}\n`);
  if (Array.isArray(data.notes) && !flags.json) {
    for (const note of data.notes) {
      if (typeof note === 'string' && note.length > 0) process.stderr.write(`${note}\n`);
    }
  }
}

function writeNetworkCliOutput(data: Record<string, unknown>): void {
  const pathOut = typeof data.path === 'string' ? data.path : '';
  if (pathOut) process.stdout.write(`${pathOut}\n`);
  const entries = Array.isArray(data.entries) ? data.entries : [];
  if (entries.length === 0) {
    process.stdout.write('No recent HTTP(s) entries found.\n');
  } else {
    for (const entry of entries as Array<Record<string, unknown>>) {
      const method = typeof entry.method === 'string' ? entry.method : 'HTTP';
      const url = typeof entry.url === 'string' ? entry.url : '<unknown-url>';
      const status = typeof entry.status === 'number' ? ` status=${entry.status}` : '';
      const timestamp = typeof entry.timestamp === 'string' ? `${entry.timestamp} ` : '';
      const durationMs =
        typeof entry.durationMs === 'number' ? ` durationMs=${entry.durationMs}` : '';
      process.stdout.write(`${timestamp}${method} ${url}${status}${durationMs}\n`);
      if (typeof entry.headers === 'string') process.stdout.write(`  headers: ${entry.headers}\n`);
      if (typeof entry.requestBody === 'string')
        process.stdout.write(`  request: ${entry.requestBody}\n`);
      if (typeof entry.responseBody === 'string')
        process.stdout.write(`  response: ${entry.responseBody}\n`);
    }
  }
  const networkMetaFields = [
    'active',
    'state',
    'backend',
    'include',
    'scannedLines',
    'matchedLines',
  ] as const;
  const meta = networkMetaFields
    .map((key) => (data[key] !== undefined && data[key] !== null ? `${key}=${data[key]}` : ''))
    .filter(Boolean)
    .join(' ');
  if (meta) process.stderr.write(`${meta}\n`);
  if (Array.isArray(data.notes)) {
    for (const note of data.notes) {
      if (typeof note === 'string' && note.length > 0) process.stderr.write(`${note}\n`);
    }
  }
}
