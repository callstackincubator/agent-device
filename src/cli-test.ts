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

  const prefix =
    result.status === 'passed'
      ? isFlakyReplayTestResult(result)
        ? 'FLAKY'
        : 'PASS'
      : result.status === 'skipped'
        ? 'SKIP'
        : 'INFO';
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
  if (result.error?.hint) process.stdout.write(`  hint: ${result.error.hint}\n`);
  if (result.artifactsDir) process.stdout.write(`  artifacts: ${result.artifactsDir}\n`);
  if (result.error?.logPath) process.stdout.write(`  log: ${result.error.logPath}\n`);
  if (result.error?.diagnosticId) {
    process.stdout.write(`  diagnostic: ${result.error.diagnosticId}\n`);
  }
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

export function getReplayTestExitCode(data: ReplaySuiteResult): number {
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
  if (test.error.hint) lines.push(`hint: ${test.error.hint}`);
  if (test.error.diagnosticId) lines.push(`diagnosticId: ${test.error.diagnosticId}`);
  if (test.error.logPath) lines.push(`logPath: ${test.error.logPath}`);
  if (test.artifactsDir) lines.push(`artifactsDir: ${test.artifactsDir}`);
  const details = test.error.details ? JSON.stringify(test.error.details, null, 2) : undefined;
  if (details) lines.push(`details: ${details}`);
  return lines.join('\n');
}

function buildSystemOut(test: ReplaySuiteTestResult): string {
  const lines = [`status: ${test.status}`, `durationMs: ${test.durationMs}`];
  if ('attempts' in test) lines.push(`attempts: ${test.attempts}`);
  if ('session' in test) lines.push(`session: ${test.session}`);
  if ('replayed' in test) lines.push(`replayed: ${test.replayed}`);
  if ('healed' in test) lines.push(`healed: ${test.healed}`);
  if ('artifactsDir' in test && test.artifactsDir) lines.push(`artifactsDir: ${test.artifactsDir}`);
  if (test.status === 'passed' && test.attempts > 1) lines.push('flaky: true');
  return lines.join('\n');
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
