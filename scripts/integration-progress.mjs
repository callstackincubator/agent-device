#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CHECK_MODE = process.argv.includes('--check');
const HANDLER_TEST_DIR = path.join(ROOT, 'src/daemon/handlers/__tests__');
const PROVIDER_SCENARIO_DIR = path.join(ROOT, 'test/integration/provider-scenarios');
const COVERAGE_SUMMARY = path.join(ROOT, 'coverage/coverage-summary.json');
const COMMAND_CATALOG = path.join(ROOT, 'src/command-catalog.ts');

const handlerTests = listFiles(HANDLER_TEST_DIR, (file) => file.endsWith('.test.ts'));
const providerScenarioTests = listFiles(PROVIDER_SCENARIO_DIR, (file) => file.endsWith('.test.ts'));
const providerScenarioSources = listFiles(PROVIDER_SCENARIO_DIR, (file) => file.endsWith('.ts'));
const providerScenarioSupportSources = providerScenarioSources.filter((file) => !file.endsWith('.test.ts'));
const handlerStats = summarizeFiles(handlerTests);
const providerScenarioStats = summarizeFiles(providerScenarioTests);
const providerScenarioSupportStats = summarizeFiles(providerScenarioSupportSources);
const mockHeavyHandlerFiles = handlerTests.filter((file) =>
  fs.readFileSync(file, 'utf8').includes('vi.mock('),
);
const mockHeavyHandlerRows = summarizeMockHeavyHandlerFiles(mockHeavyHandlerFiles);
const providerPressureRows = summarizeProviderPressure(providerScenarioSources);
const publicCommandRows = summarizePublicCommandCoverage(providerScenarioTests);
const missingPublicCommands = publicCommandRows.filter((command) => command.references === 0);
const commandFamilyRows = summarizeCommandFamilyOwnership(providerScenarioTests);
const flagCoverageRows = summarizeProviderScenarioFlagCoverage(providerScenarioSources);
const missingFlagRows = flagCoverageRows.filter((flag) => flag.references === 0);
const excludedFlagRows = summarizeProviderScenarioFlagExclusions();
const publicCliFlagKeys = readPublicCliFlagKeys();
const classifiedFlagKeys = new Set([
  ...flagCoverageRows.map((flag) => flag.key),
  ...excludedFlagRows.flatMap((group) => group.keys),
]);
const unclassifiedFlagKeys = [...publicCliFlagKeys].filter((key) => !classifiedFlagKeys.has(key));
const coverage = readCoverageSummary();
const lowCoverageFiles = readLowCoverageFiles();

const rows = [
  ['Handler unit test files', String(handlerStats.files)],
  ['Handler unit test LOC', String(handlerStats.lines)],
  ['Handler unit tests', String(handlerStats.tests)],
  ['Handler files with vi.mock', String(mockHeavyHandlerFiles.length)],
  ['Provider scenario files', String(providerScenarioStats.files)],
  ['Provider scenario LOC', String(providerScenarioStats.lines)],
  ['Provider scenario tests', String(providerScenarioStats.tests)],
  ['Provider scenario support files', String(providerScenarioSupportStats.files)],
  ['Provider scenario support LOC', String(providerScenarioSupportStats.lines)],
  ['Provider scenario / handler LOC', ratio(providerScenarioStats.lines, handlerStats.lines)],
  [
    'Public commands covered by provider-backed integration',
    `${publicCommandRows.length - missingPublicCommands.length}/${publicCommandRows.length}`,
  ],
  ['Public commands missing provider-backed integration coverage', String(missingPublicCommands.length)],
  [
    'Device-observable workflow flags covered by provider-backed integration',
    `${flagCoverageRows.length - missingFlagRows.length}/${flagCoverageRows.length}`,
  ],
  ['Device-observable workflow flags missing provider-backed integration coverage', String(missingFlagRows.length)],
  [
    'Public CLI flags intentionally outside provider-backed integration',
    String(excludedFlagRows.reduce((sum, group) => sum + group.keys.length, 0)),
  ],
  ['Public CLI flags unclassified by progress script', String(unclassifiedFlagKeys.length)],
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

console.log('Provider-backed integration status');
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
  console.log('Command family ownership in provider-backed integration');
  console.log('');
  console.log('| Command family | Command references | Files |');
  console.log('| --- | ---: | ---: |');
  for (const family of commandFamilyRows) {
    console.log(`| ${family.name} | ${family.references} | ${family.files} |`);
  }
}

if (missingPublicCommands.length > 0) {
  console.log('');
  console.log('Public command coverage gaps');
  console.log('');
  console.log('| Command |');
  console.log('| --- |');
  for (const command of missingPublicCommands) {
    console.log(`| ${command.command} |`);
  }
}

if (missingFlagRows.length > 0) {
  console.log('');
  console.log('Device-observable workflow flag coverage gaps');
  console.log('');
  console.log('| Flag | Intended integration coverage |');
  console.log('| --- | --- |');
  for (const flag of missingFlagRows) {
    console.log(`| ${flag.key} | ${flag.reason} |`);
  }
}

if (excludedFlagRows.length > 0) {
  console.log('');
  console.log('Public CLI flag coverage outside provider-backed integration');
  console.log('');
  console.log('| Bucket | Flags | Coverage owner |');
  console.log('| --- | --- | --- |');
  for (const group of excludedFlagRows) {
    console.log(`| ${group.name} | ${group.keys.join(', ')} | ${group.owner} |`);
  }
}

if (unclassifiedFlagKeys.length > 0) {
  console.log('');
  console.log('Unclassified public CLI flags');
  console.log('');
  console.log('| Flag |');
  console.log('| --- |');
  for (const key of unclassifiedFlagKeys) {
    console.log(`| ${key} |`);
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

if (CHECK_MODE) {
  const failures = [];
  if (missingPublicCommands.length > 0) {
    failures.push(
      `missing Provider-backed integration command coverage: ${missingPublicCommands.map((row) => row.command).join(', ')}`,
    );
  }
  if (missingFlagRows.length > 0) {
    failures.push(
      `missing Provider-backed integration workflow flag coverage: ${missingFlagRows.map((row) => row.key).join(', ')}`,
    );
  }
  if (unclassifiedFlagKeys.length > 0) {
    failures.push(`unclassified public CLI flags: ${unclassifiedFlagKeys.join(', ')}`);
  }
  if (failures.length > 0) {
    console.error('');
    console.error(`provider-backed integration progress check failed: ${failures.join('; ')}`);
    process.exit(1);
  }
}

function summarizeProviderScenarioFlagCoverage(files) {
  const flagTargets = [
    ['platform', 'selection across platform-specific provider-backed integration flows'],
    ['target', 'target-class routing such as tv/mobile/desktop'],
    ['device', 'human-readable device selection'],
    ['udid', 'Apple device selection'],
    ['serial', 'Android device selection'],
    ['iosSimulatorDeviceSet', 'iOS simulator-set scoping reaches inventory resolution'],
    ['androidDeviceAllowlist', 'Android serial allowlist reaches inventory resolution'],
    ['session', 'named session routing'],
    ['surface', 'macOS app/frontmost/desktop/menubar surfaces'],
    ['activity', 'Android explicit launch activity'],
    ['launchConsole', 'iOS simulator launch console capture'],
    ['saveScript', 'open/close replay recording output'],
    ['relaunch', 'open terminates before launch'],
    ['shutdown', 'close/disconnect shutdown behavior'],
    ['appsFilter', 'apps --all vs default filtering'],
    ['header', 'install-from-source URL headers', ['headers']],
    ['retainPaths', 'retained install-source materialization'],
    ['retentionMs', 'install-source materialization TTL'],
    ['count', 'repeated press/click/swipe input'],
    ['fps', 'recording frame-rate request'],
    ['quality', 'recording quality scaling'],
    ['hideTouches', 'recording without touch overlays'],
    ['intervalMs', 'repeated press interval'],
    ['delayMs', 'typing/fill delay'],
    ['holdMs', 'press hold duration'],
    ['jitterPx', 'press jitter'],
    ['pixels', 'scroll distance'],
    ['doubleTap', 'double tap gesture'],
    ['clickButton', 'desktop mouse button selection', ['button']],
    ['backMode', 'explicit app/system back behavior', ['mode']],
    ['pauseMs', 'swipe repeat pause'],
    ['pattern', 'swipe repeat pattern'],
    ['snapshotInteractiveOnly', 'interactive snapshot/ref refresh', ['interactiveOnly']],
    ['snapshotCompact', 'compact snapshot output', ['compact']],
    ['snapshotDepth', 'scoped snapshot depth', ['depth']],
    ['snapshotScope', 'scoped snapshot capture', ['scope']],
    ['snapshotRaw', 'raw snapshot node output', ['raw']],
    ['out', 'artifact output path plumbing'],
    ['overlayRefs', 'screenshot ref overlay annotation'],
    ['screenshotFullscreen', 'screenshot full-screen capture mode'],
    ['screenshotMaxSize', 'screenshot max-size post-processing'],
    ['screenshotNoStabilize', 'screenshot stabilization opt-out', ['stabilize']],
    ['restart', 'logs clear --restart workflow'],
    ['networkInclude', 'network dump include modes', ['include']],
    ['noRecord', 'action recording suppression'],
    ['replayUpdate', 'selector-healing replay update', ['update']],
    ['replayEnv', 'replay/test variable injection', ['env']],
    ['failFast', 'test suite stops after first failure'],
    ['timeoutMs', 'wait/test timeout flags'],
    ['retries', 'test suite retry budget flows through request path'],
    ['artifactsDir', 'test artifact root'],
    ['steps', 'batch inline steps'],
    ['batchOnError', 'batch stop-on-error policy', ['onError']],
    ['batchMaxSteps', 'batch max-step guard', ['maxSteps']],
    ['findFirst', 'find first disambiguation'],
    ['findLast', 'find last disambiguation'],
  ];
  const sources = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  return flagTargets.map(([key, reason, aliases = []]) => {
    const references = [key, ...aliases].reduce(
      (count, candidate) => count + countFlagReferences(sources, candidate),
      0,
    );
    return { key, reason, references };
  });
}

function countFlagReferences(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.match(new RegExp(`\\b${escaped}\\s*:`, 'g'))?.length ?? 0;
}

function summarizeProviderScenarioFlagExclusions() {
  return [
    {
      name: 'config, output, diagnostics, and transport',
      owner: 'args/CLI transport/auth tests',
      keys: [
        'config',
        'remoteConfig',
        'stateDir',
        'daemonBaseUrl',
        'daemonAuthToken',
        'daemonTransport',
        'daemonServerMode',
        'tenant',
        'sessionIsolation',
        'runId',
        'leaseId',
        'leaseBackend',
        'json',
        'help',
        'version',
        'verbose',
      ],
    },
    {
      name: 'remote connection and session-lock policy',
      owner: 'connection/runtime/request policy tests',
      keys: ['force', 'noLogin', 'sessionLock', 'sessionLocked', 'sessionLockConflicts'],
    },
    {
      name: 'Metro and React Native runtime preparation',
      owner: 'Metro companion integration and parser tests',
      keys: [
        'metroHost',
        'metroPort',
        'metroProjectRoot',
        'metroKind',
        'metroPublicBaseUrl',
        'metroProxyBaseUrl',
        'metroBearerToken',
        'metroPreparePort',
        'metroListenHost',
        'metroStatusHost',
        'metroStartupTimeoutMs',
        'metroProbeTimeoutMs',
        'metroRuntimeFile',
        'metroNoReuseExisting',
        'metroNoInstallDeps',
        'bundleUrl',
        'launchUrl',
      ],
    },
    {
      name: 'parser/client-only command flags',
      owner: 'args, CLI, screenshot-diff, and batch tests',
      keys: [
        'githubActionsArtifact',
        'snapshotDiff',
        'snapshotForceFull',
        'baseline',
        'threshold',
        'reportJunit',
        'replayMaestro',
        'stepsFile',
      ],
    },
    {
      name: 'platform boot fallback without provider seam',
      owner: 'handler and Android platform unit tests',
      keys: ['headless'],
    },
  ];
}

function readPublicCliFlagKeys() {
  const sources = [
    path.join(ROOT, 'src/utils/command-schema.ts'),
    path.join(ROOT, 'src/commands/capture-screenshot-options.ts'),
  ];
  const keys = new Set();
  for (const source of sources) {
    const text = fs.readFileSync(source, 'utf8');
    for (const match of text.matchAll(/\{\s*key: '([^']+)'[\s\S]*?names:\s*\[([^\]]*)\]/g)) {
      const key = match[1];
      const names = match[2] ?? '';
      if (names.includes("'--") || names.includes("'-")) {
        keys.add(key);
      }
    }
  }
  return keys;
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
      name: 'Apple simctl/devicectl provider',
      pattern:
        /\bsimctl\b|\bdevicectl\b|\brunXcrun\b|\bsimctl\s*:|\bdevicectl\s*:/g,
    },
    {
      name: 'Apple macOS helper provider',
      pattern: /\bmacos-helper\b|\bagent-device-macos-helper\b|\bmacosHelper\s*:/g,
    },
    {
      name: 'Apple macOS host provider',
      pattern:
        /\bmacos-host\b|\bmacosHost\s*:|\bAppleMacOsHostProvider\b|\bopenBundle\b|\bopenTarget\b|\breadClipboard\b|\bwriteClipboard\b|\breadDarkMode\b|\bsetDarkMode\b|\blistApps\b/g,
    },
    {
      name: 'Apple generic host-tool provider',
      pattern:
        /\bxcrun\b|['"](?:open|pbcopy|pbpaste|plutil|osascript|swift|codesign|mdfind|ps|pkill)['"]/g,
    },
    {
      name: 'Linux semantic desktop provider',
      pattern: /\bdesktop\b|\bopenTarget\b|\bcloseApp\b/g,
    },
    {
      name: 'Linux semantic accessibility/clipboard/screenshot provider',
      pattern:
        /\baccessibility\b|\bcaptureTree\b|\bclipboard\b|\breadText\b|\bwriteText\b|\bscreenshot\b|\bcapture\s*:/g,
    },
    {
      name: 'Linux semantic input provider',
      pattern: /\bLinuxInputProvider\b|\bprovider\.input\b|\binput\s*:|\['input'/g,
    },
    {
      name: 'Linux generic tool provider',
      pattern:
        /\bLinuxToolProvider\b|\blinuxToolProvider\b|\brunCommand\b|\bwhichCommand\b|\bxdotool\b|\bydotool\b|\bxclip\b|\bscrot\b|\bgrim\b|\bwmctrl\b|\bpkill\b/g,
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
      name: 'devices/boot/open/close/session/appstate',
      commands: ['devices', 'boot', 'open', 'close', 'session_list', 'appstate'],
    },
    {
      name: 'apps',
      commands: ['apps'],
    },
    {
      name: 'install/reinstall/install-source/push/trigger-event',
      commands: ['install', 'reinstall', 'install-from-source', 'push', 'trigger-app-event'],
    },
    {
      name: 'snapshot/diff/screenshot',
      commands: ['snapshot', 'diff', 'screenshot'],
    },
    {
      name: 'press/click/fill/type/scroll/swipe/gesture/rotate/app-switcher',
      commands: [
        'press',
        'click',
        'focus',
        'longpress',
        'swipe',
        'scroll',
        'gesture',
        'type',
        'fill',
        'rotate',
        'app-switcher',
        'back',
        'home',
      ],
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
      name: 'record/trace/logs/network/perf/replay/test/batch',
      commands: ['record', 'trace', 'logs', 'network', 'perf', 'replay', 'test', 'batch'],
    },
  ];

  const commandRefsByFile = files.map((file) => ({
    file,
    commands: extractProviderScenarioCommandReferences(fs.readFileSync(file, 'utf8')),
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

function summarizePublicCommandCoverage(files) {
  const publicCommands = readPublicCommands();
  const commandRefsByFile = files.map((file) => ({
    file,
    commands: extractProviderScenarioCommandReferences(fs.readFileSync(file, 'utf8')),
  }));

  return publicCommands.map((command) => {
    let references = 0;
    let filesWithReferences = 0;
    for (const file of commandRefsByFile) {
      const count = file.commands.filter((candidate) => candidate === command).length;
      references += count;
      if (count > 0) filesWithReferences += 1;
    }
    return { command, references, files: filesWithReferences };
  });
}

function readPublicCommands() {
  const text = fs.readFileSync(COMMAND_CATALOG, 'utf8');
  const match = text.match(/export const PUBLIC_COMMANDS = \{([\s\S]*?)\} as const;/);
  if (!match) {
    throw new Error('Unable to find PUBLIC_COMMANDS in src/command-catalog.ts');
  }
  const commands = [];
  for (const command of match[1].matchAll(/:\s*'([^']+)'/g)) {
    commands.push(command[1]);
  }
  return commands.sort();
}

function extractProviderScenarioCommandReferences(text) {
  const commands = [];
  for (const match of text.matchAll(/\bcommand:\s*['"]([^'"]+)['"]|\.callCommand\(\s*['"]([^'"]+)['"]/g)) {
    commands.push(match[1] ?? match[2]);
  }
  const typedClientCommands = new Map([
    ['devices.list', 'devices'],
    ['devices.boot', 'boot'],
    ['apps.open', 'open'],
    ['apps.close', 'close'],
    ['apps.list', 'apps'],
    ['apps.install', 'install'],
    ['apps.reinstall', 'reinstall'],
    ['apps.installFromSource', 'install-from-source'],
    ['apps.push', 'push'],
    ['apps.triggerEvent', 'trigger-app-event'],
    ['command.appState', 'appstate'],
    ['command.appSwitcher', 'app-switcher'],
    ['command.back', 'back'],
    ['command.clipboard', 'clipboard'],
    ['command.home', 'home'],
    ['command.keyboard', 'keyboard'],
    ['command.rotate', 'rotate'],
    ['command.wait', 'wait'],
    ['capture.diff', 'diff'],
    ['capture.screenshot', 'screenshot'],
    ['capture.snapshot', 'snapshot'],
    ['interactions.click', 'click'],
    ['interactions.fill', 'fill'],
    ['interactions.find', 'find'],
    ['interactions.focus', 'focus'],
    ['interactions.get', 'get'],
    ['interactions.is', 'is'],
    ['interactions.longPress', 'longpress'],
    ['interactions.pan', 'gesture'],
    ['interactions.fling', 'gesture'],
    ['interactions.pinch', 'gesture'],
    ['interactions.rotateGesture', 'gesture'],
    ['interactions.press', 'press'],
    ['interactions.scroll', 'scroll'],
    ['interactions.swipe', 'swipe'],
    ['interactions.type', 'type'],
    ['observability.logs', 'logs'],
    ['observability.network', 'network'],
    ['observability.perf', 'perf'],
    ['recording.record', 'record'],
    ['recording.trace', 'trace'],
    ['replay.run', 'replay'],
    ['replay.test', 'test'],
    ['batch.run', 'batch'],
    ['settings.update', 'settings'],
  ]);
  for (const [method, command] of typedClientCommands) {
    const escapedMethod = method.replace('.', '\\.');
    const matches = text.match(new RegExp(`\\.${escapedMethod}\\s*\\(`, 'g'))?.length ?? 0;
    for (let index = 0; index < matches; index += 1) commands.push(command);
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
