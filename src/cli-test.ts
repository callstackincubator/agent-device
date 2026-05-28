import fs from 'node:fs';
import path from 'node:path';
import type { ReplaySuiteResult, ReplaySuiteTestResult } from './daemon/types.ts';
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
    for (const entry of data.failures) {
      renderFailedTestResult(entry);
    }
    for (const entry of flaky) {
      renderFlakyTestResult(entry);
    }
  }

  const durationMs = typeof data.durationMs === 'number' ? data.durationMs : undefined;
  const flakySuffix = flaky.length > 0 ? `, ${flaky.length} flaky` : '';
  process.stdout.write(
    `Test summary: ${data.passed} passed, ${data.failed} failed${flakySuffix}${durationMs !== undefined ? ` in ${durationMs}ms` : ''}\n`,
  );
  return getReplayTestExitCode(data);
}

function renderVerboseTestResult(result: ReplaySuiteTestResult): void {
  if (result.status === 'failed') {
    renderFailedTestResult(result);
    return;
  }

  const prefix = replayResultPrefix(result);
  const attemptSuffix =
    'attempts' in result && result.attempts > 1 ? ` after ${result.attempts} attempts` : '';
  const durationSuffix = result.durationMs > 0 ? ` (${result.durationMs}ms)` : '';
  process.stdout.write(`${prefix} ${result.file}${attemptSuffix}${durationSuffix}\n`);
  if (result.status === 'skipped') {
    process.stdout.write(`  ${result.message ?? 'skipped'}\n`);
  }
}

function renderFailedTestResult(
  result: Extract<ReplaySuiteTestResult, { status: 'failed' }>,
): void {
  const attemptSuffix = result.attempts > 1 ? ` after ${result.attempts} attempts` : '';
  const durationSuffix = result.durationMs > 0 ? ` (${result.durationMs}ms)` : '';
  process.stdout.write(`FAIL ${result.file}${attemptSuffix}${durationSuffix}\n`);
  process.stdout.write(`  ${result.error?.message ?? 'Unknown test failure'}\n`);
  for (const line of replayFailureConsoleLines(result)) {
    process.stdout.write(`  ${line}\n`);
  }
}

function replayResultPrefix(result: ReplaySuiteTestResult): string {
  if (result.status === 'passed') return result.attempts > 1 ? 'FLAKY' : 'PASS';
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

function renderFlakyTestResult(result: Extract<ReplaySuiteTestResult, { status: 'passed' }>): void {
  const durationSuffix = result.durationMs > 0 ? ` (${result.durationMs}ms)` : '';
  process.stdout.write(`FLAKY ${result.file} after ${result.attempts} attempts${durationSuffix}\n`);
}

function isFlakyReplayTestResult(
  result: ReplaySuiteTestResult,
): result is Extract<ReplaySuiteTestResult, { status: 'passed' }> {
  return result.status === 'passed' && result.attempts > 1;
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
  const name = xmlEscape(path.basename(test.file));
  const className = xmlEscape(
    path.dirname(test.file) === '.' ? test.file : path.dirname(test.file),
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
  appendOptionalLine(
    lines,
    'artifactsDir' in test && test.artifactsDir ? `artifactsDir: ${test.artifactsDir}` : undefined,
  );
  if (test.status === 'failed') {
    appendReplayFailureSystemOut(lines, test);
  }
  appendOptionalLine(lines, isFlakyReplayTestResult(test) ? 'flaky: true' : undefined);
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
