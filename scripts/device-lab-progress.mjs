#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const HANDLER_TEST_DIR = path.join(ROOT, 'src/daemon/handlers/__tests__');
const DEVICE_LAB_DIR = path.join(ROOT, 'test/integration/device-lab');
const COVERAGE_SUMMARY = path.join(ROOT, 'coverage/coverage-summary.json');

const handlerTests = listFiles(HANDLER_TEST_DIR, (file) => file.endsWith('.test.ts'));
const deviceLabTests = listFiles(DEVICE_LAB_DIR, (file) => file.endsWith('.test.ts'));
const deviceLabSources = listFiles(DEVICE_LAB_DIR, (file) => file.endsWith('.ts'));
const deviceLabSupportSources = deviceLabSources.filter((file) => !file.endsWith('.test.ts'));
const handlerStats = summarizeFiles(handlerTests);
const deviceLabStats = summarizeFiles(deviceLabTests);
const deviceLabSupportStats = summarizeFiles(deviceLabSupportSources);
const mockHeavyHandlerFiles = handlerTests.filter((file) =>
  fs.readFileSync(file, 'utf8').includes('vi.mock('),
);
const mockHeavyHandlerRows = summarizeMockHeavyHandlerFiles(mockHeavyHandlerFiles);
const providerPressureRows = summarizeProviderPressure(deviceLabSources);
const commandFamilyRows = summarizeCommandFamilyOwnership(deviceLabTests);
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
  ['Device Lab support files', String(deviceLabSupportStats.files)],
  ['Device Lab support LOC', String(deviceLabSupportStats.lines)],
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

if (mockHeavyHandlerRows.length > 0) {
  console.log('');
  console.log('Mock-heavy handler unit tests');
  console.log('');
  console.log('| Tests | LOC | File |');
  console.log('| ---: | ---: | --- |');
  for (const file of mockHeavyHandlerRows) {
    console.log(`| ${file.tests} | ${file.lines} | ${file.file} |`);
  }
}

if (commandFamilyRows.length > 0) {
  console.log('');
  console.log('Command family ownership in Device Lab');
  console.log('');
  console.log('| Command family | Command references | Files |');
  console.log('| --- | ---: | ---: |');
  for (const family of commandFamilyRows) {
    console.log(`| ${family.name} | ${family.references} | ${family.files} |`);
  }
}

if (providerPressureRows.length > 0) {
  console.log('');
  console.log('Provider transcript pressure');
  console.log('');
  console.log('| Contract surface | References | Files |');
  console.log('| --- | ---: | ---: |');
  for (const pressure of providerPressureRows) {
    console.log(`| ${pressure.name} | ${pressure.references} | ${pressure.files} |`);
  }
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
    tests += countTestDeclarations(text);
  }
  return { files: files.length, lines, tests };
}

function summarizeMockHeavyHandlerFiles(files) {
  return files
    .map((file) => {
      const text = fs.readFileSync(file, 'utf8');
      return {
        file: path.relative(ROOT, file),
        lines: text.split('\n').length,
        tests: countTestDeclarations(text),
      };
    })
    .sort((a, b) => b.lines - a.lines)
    .slice(0, 12);
}

function summarizeProviderPressure(files) {
  const surfaces = [
    {
      name: 'Android ADB provider',
      pattern: /\bAndroidAdbProvider\b|\bandroidAdbProvider\b|\badbProvider\b|\badb\.(?:exec|installer|puller|portReverse)\b/g,
    },
    {
      name: 'Apple runner provider',
      pattern: /\bAppleRunnerProvider\b|\bappleRunnerProvider\b|\b(?:ios|macos|tvos)\.runner\b/g,
    },
    {
      name: 'Apple raw tool/helper provider',
      pattern:
        /\bAppleToolProvider\b|\bappleToolProvider\b|\bcreateRecordingAppleToolProvider\b|\bagent-device-macos-helper\b|\bxcrun\b|\bsimctl\b|\bdevicectl\b|\bplutil\b|\bosascript\b/g,
    },
    {
      name: 'Linux raw tool provider',
      pattern:
        /\bLinuxToolProvider\b|\blinuxToolProvider\b|\bxdotool\b|\bydotool\b|\bxclip\b|\bscrot\b|\bgrim\b|\bwmctrl\b|\bpkill\b/g,
    },
    {
      name: 'Recording provider',
      pattern: /\bRecordingProvider\b|\brecordingProvider\b|\bstartRecording\b/g,
    },
  ];

  return surfaces
    .map((surface) => {
      let references = 0;
      let filesWithReferences = 0;
      for (const file of files) {
        const text = fs.readFileSync(file, 'utf8');
        const matches = text.match(surface.pattern)?.length ?? 0;
        references += matches;
        if (matches > 0) filesWithReferences += 1;
      }
      return {
        name: surface.name,
        references,
        files: filesWithReferences,
      };
    })
    .filter((surface) => surface.references > 0);
}

function summarizeCommandFamilyOwnership(files) {
  const commandFamilies = [
    {
      name: 'open/close/session/appstate',
      commands: ['open', 'close', 'session_list', 'appstate'],
    },
    {
      name: 'apps',
      commands: ['apps'],
    },
    {
      name: 'install/reinstall/push',
      commands: ['install', 'reinstall', 'push'],
    },
    {
      name: 'snapshot/screenshot',
      commands: ['snapshot', 'screenshot'],
    },
    {
      name: 'press/click/fill/type/scroll/swipe',
      commands: ['press', 'click', 'focus', 'longpress', 'swipe', 'scroll', 'type', 'fill'],
    },
    {
      name: 'get/is/find/wait',
      commands: ['get', 'is', 'find', 'wait'],
    },
    {
      name: 'clipboard/keyboard/settings/alert',
      commands: ['clipboard', 'keyboard', 'settings', 'alert'],
    },
    {
      name: 'record/trace/logs/replay/batch',
      commands: ['record', 'trace', 'logs', 'replay', 'batch'],
    },
  ];

  const commandRefsByFile = files.map((file) => ({
    file,
    commands: extractDeviceLabCommandReferences(fs.readFileSync(file, 'utf8')),
  }));

  return commandFamilies
    .map((family) => {
      const commands = new Set(family.commands);
      let references = 0;
      let filesWithReferences = 0;
      for (const file of commandRefsByFile) {
        const count = file.commands.filter((command) => commands.has(command)).length;
        references += count;
        if (count > 0) filesWithReferences += 1;
      }
      return {
        name: family.name,
        references,
        files: filesWithReferences,
      };
    })
    .filter((family) => family.references > 0);
}

function extractDeviceLabCommandReferences(text) {
  const commands = [];
  for (const match of text.matchAll(/\bcommand:\s*['"]([^'"]+)['"]|\.callCommand\(\s*['"]([^'"]+)['"]/g)) {
    commands.push(match[1] ?? match[2]);
  }
  return commands;
}

function countTestDeclarations(text) {
  return [...text.matchAll(/(?:^|[^\w.])test\(/g)].length;
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
