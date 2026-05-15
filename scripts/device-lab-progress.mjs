#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HANDLER_TEST_DIR = path.join(ROOT, 'src/daemon/handlers/__tests__');
const DEVICE_LAB_DIR = path.join(ROOT, 'test/integration/device-lab');
const COVERAGE_SUMMARY = path.join(ROOT, 'coverage/coverage-summary.json');

const handlerTests = listFiles(HANDLER_TEST_DIR, (file) => file.endsWith('.test.ts'));
const deviceLabTests = listFiles(DEVICE_LAB_DIR, (file) => file.endsWith('.test.ts'));
const handlerStats = summarizeFiles(handlerTests);
const deviceLabStats = summarizeFiles(deviceLabTests);
const mockHeavyHandlerFiles = handlerTests.filter((file) =>
  fs.readFileSync(file, 'utf8').includes('vi.mock('),
);
const coverage = readCoverageSummary();
const lowCoverageFiles = readLowCoverageFiles();

const rows = [
  ['Handler unit test files', String(handlerStats.files)],
  ['Handler unit test LOC', String(handlerStats.lines)],
  ['Handler unit tests', String(handlerStats.tests)],
  ['Handler files with vi.mock', String(mockHeavyHandlerFiles.length)],
  ['Device Lab files', String(deviceLabStats.files)],
  ['Device Lab LOC', String(deviceLabStats.lines)],
  ['Device Lab tests', String(deviceLabStats.tests)],
  ['Device Lab / handler LOC', ratio(deviceLabStats.lines, handlerStats.lines)],
];

if (coverage) {
  rows.push(
    ['Coverage statements', formatPercent(coverage.statements)],
    ['Coverage branches', formatPercent(coverage.branches)],
    ['Coverage functions', formatPercent(coverage.functions)],
    ['Coverage lines', formatPercent(coverage.lines)],
  );
} else {
  rows.push(['Coverage summary', 'not available; run pnpm test:coverage first']);
}

console.log('Device Lab migration progress');
console.log('');
console.log('| Measure | Value |');
console.log('| --- | ---: |');
for (const [name, value] of rows) {
  console.log(`| ${name} | ${value} |`);
}

if (lowCoverageFiles.length > 0) {
  console.log('');
  console.log('Lowest covered implementation files');
  console.log('');
  console.log('| Missing statements | Statements | Statement coverage | File |');
  console.log('| ---: | ---: | ---: | --- |');
  for (const file of lowCoverageFiles) {
    console.log(
      `| ${file.missingStatements} | ${file.statementTotal} | ${formatPercent(file.statementPercent)} | ${file.file} |`,
    );
  }
}

function listFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, predicate);
    return predicate(fullPath) ? [fullPath] : [];
  });
}

function summarizeFiles(files) {
  let lines = 0;
  let tests = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    lines += text.split('\n').length;
    tests += [...text.matchAll(/\btest\(/g)].length;
  }
  return { files: files.length, lines, tests };
}

function readCoverageSummary() {
  if (!fs.existsSync(COVERAGE_SUMMARY)) return null;
  const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY, 'utf8'));
  const total = summary.total;
  if (!total) return null;
  return {
    statements: Number(total.statements?.pct ?? 0),
    branches: Number(total.branches?.pct ?? 0),
    functions: Number(total.functions?.pct ?? 0),
    lines: Number(total.lines?.pct ?? 0),
  };
}

function readLowCoverageFiles() {
  if (!fs.existsSync(COVERAGE_SUMMARY)) return [];
  const summary = JSON.parse(fs.readFileSync(COVERAGE_SUMMARY, 'utf8'));
  return Object.entries(summary)
    .filter(([file]) => file !== 'total')
    .map(([file, value]) => {
      const statements = value.statements ?? {};
      const statementTotal = Number(statements.total ?? 0);
      const statementCovered = Number(statements.covered ?? 0);
      return {
        file: path.relative(ROOT, file),
        statementPercent: Number(statements.pct ?? 0),
        statementTotal,
        missingStatements: statementTotal - statementCovered,
      };
    })
    .filter((file) => file.statementTotal >= 10 && file.statementPercent < 60)
    .sort((a, b) => b.missingStatements - a.missingStatements)
    .slice(0, 10);
}

function ratio(numerator, denominator) {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function formatPercent(value) {
  return `${value.toFixed(2)}%`;
}
