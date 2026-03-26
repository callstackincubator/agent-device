import type { ReplaySuiteResult, ReplaySuiteTestResult } from './daemon/types.ts';
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
}): number {
  const { suite, json, verbose } = options;
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
