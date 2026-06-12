import fs from 'node:fs';
import path from 'node:path';
import type { ReplaySuiteResult, ReplaySuiteTestResult } from './daemon/types.ts';
import { replayTestStepLines } from './cli-test-trace.ts';
import { formatDurationSeconds } from './utils/duration-format.ts';
import { AppError } from './utils/errors.ts';
import { printJson } from './utils/output.ts';

type PassedReplayTestResult = Extract<ReplaySuiteTestResult, { status: 'passed' }>;
type FailedReplayTestResult = Extract<ReplaySuiteTestResult, { status: 'failed' }>;
type ReplayTestError = FailedReplayTestResult['error'];

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

function renderFailedTestResult(result: FailedReplayTestResult): void {
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

function replayFailureConsoleLines(result: FailedReplayTestResult): string[] {
  return [
    replayErrorHintLine(result.error),
    replayArtifactsLine(result, 'artifacts'),
    replayErrorLogLine(result.error, 'log'),
    replayErrorDiagnosticLine(result.error, 'diagnostic'),
  ].filter(isDefinedString);
}

function isFlakyReplayTestResult(result: ReplaySuiteTestResult): result is PassedReplayTestResult {
  return result.status === 'passed' && result.attempts > 1;
}

function renderFlakyTestSummary(results: PassedReplayTestResult[]): void {
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

function replayFailedTestDisplayName(result: FailedReplayTestResult): string {
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

function formatFlakyReplayDurationSuffix(result: PassedReplayTestResult): string {
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

function buildFailureDetails(test: FailedReplayTestResult): string {
  const lines = [test.error.message];
  appendReplayErrorMetadata(lines, test.error, { includeDetails: false });
  appendOptionalLine(lines, replayArtifactsLine(test, 'artifactsDir'));
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
  appendOptionalLine(lines, replayArtifactsLine(test, 'artifactsDir'));
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

function appendReplayFailureSystemOut(lines: string[], test: FailedReplayTestResult): void {
  lines.push(`errorCode: ${test.error.code}`);
  appendReplayErrorMetadata(lines, test.error, { includeMessage: true });
}

function appendReplayErrorMetadata(
  lines: string[],
  error: ReplayTestError,
  options: { includeMessage?: boolean; includeDetails?: boolean; detailsIndent?: number } = {},
): void {
  if (options.includeMessage) lines.push(`errorMessage: ${error.message}`);
  appendOptionalLine(lines, replayErrorHintLine(error));
  appendOptionalLine(lines, replayErrorDiagnosticLine(error, 'diagnosticId'));
  appendOptionalLine(lines, replayErrorLogLine(error, 'logPath'));
  if (options.includeDetails !== false) {
    appendReplayErrorDetails(lines, error, options.detailsIndent);
  }
}

function appendReplayErrorDetails(
  lines: string[],
  error: ReplayTestError,
  detailsIndent?: number,
): void {
  const details = error.details ? JSON.stringify(error.details, null, detailsIndent) : undefined;
  if (details) lines.push(`details: ${details}`);
}

function replayArtifactsLine(
  result: ReplaySuiteTestResult,
  label: 'artifacts' | 'artifactsDir',
): string | undefined {
  return 'artifactsDir' in result && result.artifactsDir
    ? `${label}: ${result.artifactsDir}`
    : undefined;
}

function replayErrorHintLine(error: ReplayTestError): string | undefined {
  return error.hint ? `hint: ${error.hint}` : undefined;
}

function replayErrorDiagnosticLine(
  error: ReplayTestError,
  label: 'diagnostic' | 'diagnosticId',
): string | undefined {
  return error.diagnosticId ? `${label}: ${error.diagnosticId}` : undefined;
}

function replayErrorLogLine(error: ReplayTestError, label: 'log' | 'logPath'): string | undefined {
  return error.logPath ? `${label}: ${error.logPath}` : undefined;
}

function appendOptionalLine(lines: string[], line: string | undefined): void {
  if (line) lines.push(line);
}

function isDefinedString(value: string | undefined): value is string {
  return value !== undefined;
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
