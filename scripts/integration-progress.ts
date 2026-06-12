#!/usr/bin/env node

import {
  buildIntegrationProgressFailures,
  buildIntegrationProgressModel,
  formatPercent,
} from './integration-progress-model.ts';

const CHECK_MODE = process.argv.includes('--check');
const progress = buildIntegrationProgressModel({ root: process.cwd() });

console.log('Provider-backed integration status');
console.log('');
console.log('| Measure | Value |');
console.log('| --- | ---: |');
for (const [name, value] of progress.summaryRows) {
  console.log(`| ${name} | ${value} |`);
}

if (progress.mockHeavyHandlerRows.length > 0) {
  console.log('');
  console.log('Mock-heavy handler unit tests');
  console.log('');
  console.log('| Tests | LOC | File |');
  console.log('| ---: | ---: | --- |');
  for (const file of progress.mockHeavyHandlerRows) {
    console.log(`| ${file.tests} | ${file.lines} | ${file.file} |`);
  }
}

if (progress.missingPublicCommands.length > 0) {
  console.log('');
  console.log('Public command coverage gaps');
  console.log('');
  console.log('| Command |');
  console.log('| --- |');
  for (const command of progress.missingPublicCommands) {
    console.log(`| ${command.command} |`);
  }
}

if (progress.missingFlagRows.length > 0) {
  console.log('');
  console.log('Device-observable workflow flag coverage gaps');
  console.log('');
  console.log('| Flag | Intended integration coverage |');
  console.log('| --- | --- |');
  for (const flag of progress.missingFlagRows) {
    console.log(`| ${flag.key} | ${flag.reason} |`);
  }
}

if (progress.excludedFlagRows.length > 0) {
  console.log('');
  console.log('Public CLI flag coverage outside provider-backed integration');
  console.log('');
  console.log('| Bucket | Flags | Coverage owner |');
  console.log('| --- | --- | --- |');
  for (const group of progress.excludedFlagRows) {
    console.log(`| ${group.name} | ${group.keys.join(', ')} | ${group.owner} |`);
  }
}

if (progress.unclassifiedFlagKeys.length > 0) {
  console.log('');
  console.log('Unclassified public CLI flags');
  console.log('');
  console.log('| Flag |');
  console.log('| --- |');
  for (const key of progress.unclassifiedFlagKeys) {
    console.log(`| ${key} |`);
  }
}

if (progress.providerPressureRows.length > 0) {
  console.log('');
  console.log('Provider transcript pressure');
  console.log('');
  console.log('| Contract surface | References | Files |');
  console.log('| --- | ---: | ---: |');
  for (const pressure of progress.providerPressureRows) {
    console.log(`| ${pressure.name} | ${pressure.references} | ${pressure.files} |`);
  }
}

if (progress.lowCoverageFiles.length > 0) {
  console.log('');
  console.log('Lowest covered implementation files');
  console.log('');
  console.log('| Missing statements | Statements | Statement coverage | File |');
  console.log('| ---: | ---: | ---: | --- |');
  for (const file of progress.lowCoverageFiles) {
    console.log(
      `| ${file.missingStatements} | ${file.statementTotal} | ${formatPercent(file.statementPercent)} | ${file.file} |`,
    );
  }
}

if (CHECK_MODE) {
  const failures = buildIntegrationProgressFailures(progress);
  if (failures.length > 0) {
    console.error('');
    console.error(`provider-backed integration progress check failed: ${failures.join('; ')}`);
    process.exit(1);
  }
}
