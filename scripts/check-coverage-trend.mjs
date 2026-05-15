#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const SUMMARY_PATH = path.resolve('coverage/coverage-summary.json');

const STATEMENT_TARGET = readPercentEnv('COVERAGE_STATEMENTS_TARGET', 80);
const STATEMENT_FLOOR = readPercentEnv('COVERAGE_STATEMENTS_FLOOR', 78);
const LINE_FLOOR = readPercentEnv('COVERAGE_LINES_FLOOR', 80);

if (!fs.existsSync(SUMMARY_PATH)) {
  console.error(
    `Coverage summary not found at ${SUMMARY_PATH}. Run pnpm test:coverage before checking the trend.`,
  );
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(SUMMARY_PATH, 'utf8'));
const total = summary.total;
if (!total?.statements?.pct || !total?.lines?.pct) {
  console.error(`Coverage summary at ${SUMMARY_PATH} does not contain total statement/line data.`);
  process.exit(1);
}

const statements = Number(total.statements.pct);
const branches = Number(total.branches?.pct ?? 0);
const functions = Number(total.functions?.pct ?? 0);
const lines = Number(total.lines.pct);

console.log(
  [
    `Coverage trend: statements ${formatPercent(statements)} (target ${formatPercent(STATEMENT_TARGET)}, floor ${formatPercent(STATEMENT_FLOOR)})`,
    `branches ${formatPercent(branches)}`,
    `functions ${formatPercent(functions)}`,
    `lines ${formatPercent(lines)} (floor ${formatPercent(LINE_FLOOR)})`,
  ].join(', '),
);

writeGitHubStepSummary({
  statements,
  branches,
  functions,
  lines,
  statementTarget: STATEMENT_TARGET,
  statementFloor: STATEMENT_FLOOR,
  lineFloor: LINE_FLOOR,
});

const failures = [];
if (statements < STATEMENT_FLOOR) {
  failures.push(
    `statements ${formatPercent(statements)} is below floor ${formatPercent(STATEMENT_FLOOR)}`,
  );
}
if (lines < LINE_FLOOR) {
  failures.push(`lines ${formatPercent(lines)} is below floor ${formatPercent(LINE_FLOOR)}`);
}

if (failures.length > 0) {
  console.error(`Coverage regression: ${failures.join('; ')}`);
  process.exit(1);
}

if (statements < STATEMENT_TARGET) {
  console.warn(
    `Coverage is above the regression floor but below the near-term statement target (${formatPercent(STATEMENT_TARGET)}). Add valuable integration coverage before raising the floor.`,
  );
}

function readPercentEnv(name, fallback) {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    console.error(`${name} must be a percentage between 0 and 100.`);
    process.exit(1);
  }
  return value;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}

function writeGitHubStepSummary(metrics) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  const statementRow = [
    '| Statements',
    formatPercent(metrics.statements),
    formatPercent(metrics.statementFloor),
    formatPercent(metrics.statementTarget),
    '|',
  ].join(' | ');
  fs.appendFileSync(
    summaryPath,
    [
      '## Coverage Trend',
      '',
      '| Metric | Current | Floor | Target |',
      '| --- | ---: | ---: | ---: |',
      statementRow,
      `| Lines | ${formatPercent(metrics.lines)} | ${formatPercent(metrics.lineFloor)} | - |`,
      `| Branches | ${formatPercent(metrics.branches)} | - | - |`,
      `| Functions | ${formatPercent(metrics.functions)} | - | - |`,
      '',
    ].join('\n'),
  );
}
