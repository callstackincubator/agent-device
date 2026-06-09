import fs from 'node:fs';
import path from 'node:path';
import type { ReplaySuiteResult, ReplaySuiteTestResult } from './daemon/types.ts';
import { formatDurationSeconds } from './utils/duration-format.ts';
import { AppError } from './utils/errors.ts';
import { printJson } from './utils/output.ts';

export function announceReplayTestRun(options: { json?: boolean }): void {
  if (!options.json) {
    process.stderr.write('Running replay suite...\n');
  }
}

export function renderReplayTestResponse(options: {
  suite: ReplaySuiteResult;
  json?: boolean;
  verbose?: boolean;
  reportJunit?: string;
}): number {
  const { suite, json, verbose, reportJunit } = options;
  if (reportJunit) {
    writeReplayJunitReport(reportJunit, suite);
  }
  if (json) {
    printJson({ success: true, data: suite });
    return getReplayTestExitCode(suite);
  }
  return renderReplayTestSummary(suite, { verbose });
}

function renderReplayTestSummary(
  data: ReplaySuiteResult,
  options: { verbose?: boolean } = {},
): number {
  const flaky = data.tests.filter(isFlakyReplayTestResult);
  if (options.verbose) {
    for (const entry of data.tests) {
      renderVerboseTestResult(entry);
    }
  } else {
    for (const entry of data.tests) {
      renderDefaultTestResult(entry);
    }
  }

  const durationMs = typeof data.durationMs === 'number' ? data.durationMs : undefined;
  const flakySuffix = flaky.length > 0 ? `, ${flaky.length} flaky` : '';
  const durationSuffix = durationMs !== undefined ? ` in ${formatDurationSeconds(durationMs)}` : '';
  process.stdout.write(
    `Test summary: ${data.passed} passed, ${data.failed} failed${flakySuffix}${durationSuffix}\n`,
  );
  renderFlakyTestSummary(flaky);
  return getReplayTestExitCode(data);
}

function renderDefaultTestResult(result: ReplaySuiteTestResult): void {
  if (result.status === 'failed') {
    renderFailedTestResult(result);
    return;
  }
  if (result.status !== 'passed') return;

  process.stdout.write(
    `PASS ${replayTestDisplayName(result)}${formatReplayTestDurationSuffix(result)}\n`,
  );
  for (const line of replayTestWarningLines(result)) {
    process.stdout.write(`  ${line}\n`);
  }
}

function renderVerboseTestResult(result: ReplaySuiteTestResult): void {
  if (result.status === 'failed') {
    renderFailedTestResult(result);
    return;
  }

  const durationSuffix = formatReplayTestDurationSuffix(result);
  process.stdout.write(
    `${replayResultPrefix(result)} ${replayTestDisplayName(result)}${durationSuffix}\n`,
  );
  if (result.status === 'skipped') {
    process.stdout.write(`  ${result.message ?? 'skipped'}\n`);
  }
  for (const line of replayTestWarningLines(result)) {
    process.stdout.write(`  ${line}\n`);
  }
  for (const line of replayTestStepLines(result)) {
    process.stdout.write(`  ${line}\n`);
  }
}

function renderFailedTestResult(
  result: Extract<ReplaySuiteTestResult, { status: 'failed' }>,
): void {
  const attemptSuffix = result.attempts > 1 ? ` after ${result.attempts} attempts` : '';
  const durationSuffix = formatReplayTestDurationSuffix(result);
  process.stdout.write(
    `FAIL ${replayFailedTestDisplayName(result)}${attemptSuffix}${durationSuffix}\n`,
  );
  process.stdout.write(`  ${result.error?.message ?? 'Unknown test failure'}\n`);
  for (const line of replayFailureConsoleLines(result)) {
    process.stdout.write(`  ${line}\n`);
  }
  for (const line of replayTestStepLines(result)) {
    process.stdout.write(`  ${line}\n`);
  }
}

function replayResultPrefix(result: ReplaySuiteTestResult): string {
  if (result.status === 'passed') return 'PASS';
  if (result.status === 'skipped') return 'SKIP';
  return 'INFO';
}

function replayFailureConsoleLines(
  result: Extract<ReplaySuiteTestResult, { status: 'failed' }>,
): string[] {
  return [
    result.error?.hint ? `hint: ${result.error.hint}` : '',
    result.artifactsDir ? `artifacts: ${result.artifactsDir}` : '',
    result.error?.logPath ? `log: ${result.error.logPath}` : '',
    result.error?.diagnosticId ? `diagnostic: ${result.error.diagnosticId}` : '',
  ].filter(Boolean);
}

type ReplayActionStartTrace = {
  type: 'replay_action_start';
  step: number;
  line?: number;
  command?: string;
  positionals?: unknown[];
};

type ReplayActionStopTrace = {
  type: 'replay_action_stop';
  step: number;
  line?: number;
  command?: string;
  ok?: boolean;
  durationMs?: number;
  errorCode?: string;
  resultTiming?: Record<string, unknown>;
};

function replayTestStepLines(result: ReplaySuiteTestResult): string[] {
  if (result.status === 'skipped') return [];
  const tracePath = replayTestTimingTracePath(result);
  if (!tracePath) return [];
  const events = readReplayTimingTrace(tracePath);
  if (events.length === 0) return [];

  const starts: ReplayActionStartTrace[] = [];
  const stops: Array<{ stop: ReplayActionStopTrace; start: ReplayActionStartTrace | undefined }> =
    [];
  for (const event of events) {
    if (isReplayActionStartTrace(event)) {
      starts.push(event);
      continue;
    }
    if (isReplayActionStopTrace(event)) {
      stops.push({ stop: event, start: consumeReplayActionStart(starts, event) });
    }
  }
  if (stops.length === 0) return [];

  return [
    result.attempts > 1 ? `steps (attempt ${result.attempts}):` : 'steps:',
    ...stops.map(({ stop, start }) => renderReplayStepTrace(stop, start)),
  ];
}

function consumeReplayActionStart(
  starts: ReplayActionStartTrace[],
  stop: ReplayActionStopTrace,
): ReplayActionStartTrace | undefined {
  const stopCommand = stop.command;
  const matchingIndex = starts.findIndex(
    (start) =>
      start.step === stop.step &&
      (stopCommand === undefined || start.command === undefined || start.command === stopCommand),
  );
  if (matchingIndex < 0) return undefined;
  return starts.splice(matchingIndex, 1)[0];
}

function replayTestTimingTracePath(
  result: Extract<ReplaySuiteTestResult, { status: 'passed' | 'failed' }>,
): string | undefined {
  return result.artifactsDir
    ? path.join(result.artifactsDir, `attempt-${result.attempts}`, 'replay-timing.ndjson')
    : undefined;
}

function readReplayTimingTrace(tracePath: string): Record<string, unknown>[] {
  try {
    return fs
      .readFileSync(tracePath, 'utf8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          const parsed = JSON.parse(line) as unknown;
          return isPlainRecord(parsed) ? [parsed] : [];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function isReplayActionStartTrace(event: Record<string, unknown>): event is ReplayActionStartTrace {
  return (
    event.type === 'replay_action_start' &&
    hasTraceStep(event) &&
    hasOptionalNumber(event, 'line') &&
    hasOptionalString(event, 'command') &&
    (event.positionals === undefined || Array.isArray(event.positionals))
  );
}

function isReplayActionStopTrace(event: Record<string, unknown>): event is ReplayActionStopTrace {
  return (
    event.type === 'replay_action_stop' &&
    hasTraceStep(event) &&
    hasOptionalNumber(event, 'line') &&
    hasOptionalString(event, 'command') &&
    (event.ok === undefined || typeof event.ok === 'boolean') &&
    hasOptionalNumber(event, 'durationMs') &&
    hasOptionalString(event, 'errorCode') &&
    (event.resultTiming === undefined || isPlainRecord(event.resultTiming))
  );
}

function hasTraceStep(event: Record<string, unknown>): boolean {
  return typeof event.step === 'number';
}

function hasOptionalNumber(event: Record<string, unknown>, key: string): boolean {
  return event[key] === undefined || typeof event[key] === 'number';
}

function hasOptionalString(event: Record<string, unknown>, key: string): boolean {
  return event[key] === undefined || typeof event[key] === 'string';
}

function renderReplayStepTrace(
  stop: ReplayActionStopTrace,
  start: ReplayActionStartTrace | undefined,
): string {
  const failed = stop.ok === false;
  const status = failed ? '[FAIL] ' : stop.ok === true ? '' : '[info] ';
  return `  ${status}${formatReplayStepCommand(start, stop)}${formatReplayStepDetails(stop, start)}`;
}

function formatReplayStepDetails(
  stop: ReplayActionStopTrace,
  start: ReplayActionStartTrace | undefined,
): string {
  const line = start?.line ?? stop.line;
  const details = [
    typeof line === 'number' ? `line ${line}` : '',
    typeof stop.durationMs === 'number' ? formatDurationSeconds(stop.durationMs) : '',
    stop.errorCode ?? '',
    stop.resultTiming ? `timing ${JSON.stringify(stop.resultTiming)}` : '',
  ].filter(Boolean);
  return details.length > 0 ? ` (${details.join(', ')})` : '';
}

function formatReplayStepCommand(
  start: ReplayActionStartTrace | undefined,
  stop: ReplayActionStopTrace,
): string {
  const command = formatReplayStepCommandName(start?.command ?? stop.command);
  const positionals = start?.positionals ?? [];
  return [command, ...positionals.map(formatReplayStepArg)].join(' ');
}

function formatReplayStepCommandName(command: string | undefined): string {
  if (!command) return 'unknown';
  if (!command.startsWith('__maestro')) return command;
  const name = command.slice('__maestro'.length);
  return name.length > 0 ? name[0]!.toLowerCase() + name.slice(1) : command;
}

function formatReplayStepArg(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isFlakyReplayTestResult(
  result: ReplaySuiteTestResult,
): result is Extract<ReplaySuiteTestResult, { status: 'passed' }> {
  return result.status === 'passed' && result.attempts > 1;
}

function renderFlakyTestSummary(
  results: Array<Extract<ReplaySuiteTestResult, { status: 'passed' }>>,
): void {
  if (results.length === 0) return;
  process.stdout.write('Flaky tests:\n');
  for (const result of results) {
    process.stdout.write(
      `  PASS ${replayTestDisplayName(result)} after ${result.attempts} attempts${formatFlakyReplayDurationSuffix(result)}\n`,
    );
    for (const failure of result.attemptFailures ?? []) {
      const attemptDuration =
        typeof failure.durationMs === 'number'
          ? ` (${formatDurationSeconds(failure.durationMs)})`
          : '';
      process.stdout.write(
        `    attempt ${failure.attempt} failed${attemptDuration}: ${failure.message}\n`,
      );
    }
  }
}

function replayTestDisplayName(result: ReplaySuiteTestResult): string {
  const title = replayTestTitle(result);
  const base = title && title.length > 0 ? JSON.stringify(title) : path.basename(result.file);
  return `${base}${formatReplayTestShardSuffix(result)}`;
}

function replayFailedTestDisplayName(
  result: Extract<ReplaySuiteTestResult, { status: 'failed' }>,
): string {
  const title = replayTestTitle(result);
  const filename = path.basename(result.file);
  const base = title && title.length > 0 ? `${JSON.stringify(title)} in ${filename}` : filename;
  return `${base}${formatReplayTestShardSuffix(result)}`;
}

function replayTestCaseName(result: ReplaySuiteTestResult): string {
  return `${replayTestTitle(result) ?? path.basename(result.file)}${formatReplayTestShardSuffix(result)}`;
}

function replayTestTitle(result: ReplaySuiteTestResult): string | undefined {
  const title = result.title?.trim();
  return title && title.length > 0 ? title : undefined;
}

function formatReplayTestDurationSuffix(result: ReplaySuiteTestResult): string {
  if (result.status === 'passed' && result.attempts > 1) {
    return formatFlakyReplayDurationSuffix(result);
  }
  if (result.status === 'failed' && result.attempts > 1 && result.durationMs > 0) {
    return ` (total ${formatDurationSeconds(result.durationMs)})`;
  }

  const durationMs =
    result.status === 'passed' && typeof result.finalAttemptDurationMs === 'number'
      ? result.finalAttemptDurationMs
      : result.durationMs;
  return durationMs > 0 ? ` (${formatDurationSeconds(durationMs)})` : '';
}

function formatFlakyReplayDurationSuffix(
  result: Extract<ReplaySuiteTestResult, { status: 'passed' }>,
): string {
  const timings = [
    typeof result.finalAttemptDurationMs === 'number'
      ? `passed attempt ${formatDurationSeconds(result.finalAttemptDurationMs)}`
      : '',
    result.durationMs > 0 ? `total ${formatDurationSeconds(result.durationMs)}` : '',
  ].filter(Boolean);
  return timings.length > 0 ? ` (${timings.join(', ')})` : '';
}

function getReplayTestExitCode(data: ReplaySuiteResult): number {
  return data.failed > 0 ? 1 : 0;
}

function writeReplayJunitReport(reportPath: string, suite: ReplaySuiteResult): void {
  const directory = path.dirname(reportPath);
  try {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(reportPath, buildReplayJunitXml(suite), 'utf8');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(
      'COMMAND_FAILED',
      `Failed to write JUnit report to ${reportPath}: ${message}`,
    );
  }
}

function buildReplayJunitXml(suite: ReplaySuiteResult): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites>`,
    `  <testsuite name="agent-device replay suite" tests="${suite.total}" failures="${suite.failed}" skipped="${suite.skipped}" time="${formatJUnitSeconds(suite.durationMs)}">`,
  ];

  for (const test of suite.tests) {
    lines.push(...renderJUnitTestCase(test));
  }

  lines.push('  </testsuite>');
  lines.push('</testsuites>');
  return `${lines.join('\n')}\n`;
}

function renderJUnitTestCase(test: ReplaySuiteTestResult): string[] {
  const name = xmlEscape(replayTestCaseName(test));
  const className = xmlEscape(
    `${path.dirname(test.file) === '.' ? test.file : path.dirname(test.file)}${formatReplayTestShardSuffix(test)}`,
  );
  const file = xmlEscape(test.file);
  const time = formatJUnitSeconds(test.durationMs);
  const lines = [
    `    <testcase classname="${className}" name="${name}" file="${file}" time="${time}">`,
  ];

  if (test.status === 'failed') {
    lines.push(
      `      <failure message="${xmlEscape(test.error.message)}">${xmlEscape(buildFailureDetails(test))}</failure>`,
    );
  } else if (test.status === 'skipped') {
    lines.push(`      <skipped message="${xmlEscape(test.message)}" />`);
  }

  const systemOut = buildSystemOut(test);
  if (systemOut) {
    lines.push(`      <system-out>${xmlEscape(systemOut)}</system-out>`);
  }

  lines.push('    </testcase>');
  return lines;
}

function buildFailureDetails(test: Extract<ReplaySuiteTestResult, { status: 'failed' }>): string {
  const lines = [test.error.message];
  appendReplayErrorMetadata(lines, test.error, { includeDetails: false });
  if (test.artifactsDir) lines.push(`artifactsDir: ${test.artifactsDir}`);
  appendReplayErrorDetails(lines, test.error, 2);
  return lines.join('\n');
}

function buildSystemOut(test: ReplaySuiteTestResult): string {
  const lines = [`status: ${test.status}`, `durationMs: ${test.durationMs}`];
  appendReplaySystemOutMetadata(lines, test);
  return lines.join('\n');
}

function appendReplaySystemOutMetadata(lines: string[], test: ReplaySuiteTestResult): void {
  appendOptionalLine(lines, 'attempts' in test ? `attempts: ${test.attempts}` : undefined);
  appendOptionalLine(lines, 'session' in test ? `session: ${test.session}` : undefined);
  appendOptionalLine(lines, 'replayed' in test ? `replayed: ${test.replayed}` : undefined);
  appendOptionalLine(lines, 'healed' in test ? `healed: ${test.healed}` : undefined);
  for (const warning of replayTestWarningLines(test)) {
    lines.push(warning);
  }
  appendOptionalLine(
    lines,
    'artifactsDir' in test && test.artifactsDir ? `artifactsDir: ${test.artifactsDir}` : undefined,
  );
  appendReplayTestShardMetadata(lines, test);
  if (test.status === 'failed') {
    appendReplayFailureSystemOut(lines, test);
  }
  appendOptionalLine(lines, isFlakyReplayTestResult(test) ? 'flaky: true' : undefined);
}

function formatReplayTestShardSuffix(result: ReplaySuiteTestResult): string {
  if (!('shardIndex' in result) || typeof result.shardIndex !== 'number') return '';
  const shardCount = typeof result.shardCount === 'number' ? result.shardCount : '?';
  const device = typeof result.deviceId === 'string' ? ` ${result.deviceId}` : '';
  return ` [shard ${result.shardIndex + 1}/${shardCount}${device}]`;
}

function appendReplayTestShardMetadata(lines: string[], result: ReplaySuiteTestResult): void {
  if (!('shardIndex' in result) || typeof result.shardIndex !== 'number') return;
  lines.push(`shardIndex: ${result.shardIndex}`);
  appendOptionalLine(
    lines,
    typeof result.shardCount === 'number' ? `shardCount: ${result.shardCount}` : undefined,
  );
  appendOptionalLine(
    lines,
    typeof result.deviceId === 'string' ? `deviceId: ${result.deviceId}` : undefined,
  );
}

function appendReplayFailureSystemOut(
  lines: string[],
  test: Extract<ReplaySuiteTestResult, { status: 'failed' }>,
): void {
  lines.push(`errorCode: ${test.error.code}`);
  appendReplayErrorMetadata(lines, test.error, { includeMessage: true });
}

function appendReplayErrorMetadata(
  lines: string[],
  error: Extract<ReplaySuiteTestResult, { status: 'failed' }>['error'],
  options: { includeMessage?: boolean; includeDetails?: boolean; detailsIndent?: number } = {},
): void {
  if (options.includeMessage) lines.push(`errorMessage: ${error.message}`);
  if (error.hint) lines.push(`hint: ${error.hint}`);
  if (error.diagnosticId) lines.push(`diagnosticId: ${error.diagnosticId}`);
  if (error.logPath) lines.push(`logPath: ${error.logPath}`);
  if (options.includeDetails !== false) {
    appendReplayErrorDetails(lines, error, options.detailsIndent);
  }
}

function appendReplayErrorDetails(
  lines: string[],
  error: Extract<ReplaySuiteTestResult, { status: 'failed' }>['error'],
  detailsIndent?: number,
): void {
  const details = error.details ? JSON.stringify(error.details, null, detailsIndent) : undefined;
  if (details) lines.push(`details: ${details}`);
}

function appendOptionalLine(lines: string[], line: string | undefined): void {
  if (line) lines.push(line);
}

function replayTestWarningLines(result: ReplaySuiteTestResult): string[] {
  if (result.status !== 'passed') return [];
  return (result.warnings ?? []).map((warning) => `warning: ${warning}`);
}

function formatJUnitSeconds(durationMs: number): string {
  return (Math.max(0, durationMs) / 1000).toFixed(3);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
