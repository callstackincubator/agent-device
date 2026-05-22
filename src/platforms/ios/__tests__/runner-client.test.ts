import { beforeEach, test, onTestFinished, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { mockRunCmdStreaming, mockRepairMacOsRunnerProductsIfNeeded } = vi.hoisted(() => ({
  mockRunCmdStreaming: vi.fn(),
  mockRepairMacOsRunnerProductsIfNeeded: vi.fn(),
}));

vi.mock('../../../utils/exec.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../../../utils/exec.ts')>('../../../utils/exec.ts');
  return {
    ...actual,
    runCmdStreaming: mockRunCmdStreaming,
  };
});

vi.mock('../runner-macos-products.ts', async () => {
  const actual = await vi.importActual<typeof import('../runner-macos-products.ts')>(
    '../runner-macos-products.ts',
  );
  return {
    ...actual,
    repairMacOsRunnerProductsIfNeeded: mockRepairMacOsRunnerProductsIfNeeded,
  };
});

import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';
import type { RunnerCommand } from '../runner-client.ts';
import {
  assertSafeDerivedCleanup,
  isRetryableRunnerError,
  resolveRunnerBuildFailureHint,
  resolveRunnerEarlyExitHint,
  resolveRunnerBuildDestination,
  resolveRunnerBundleBuildSettings,
  resolveRunnerDestination,
  resolveRunnerMaxConcurrentDestinationsFlag,
  resolveRunnerSigningBuildSettings,
  shouldRetryRunnerConnectError,
  isReadOnlyRunnerCommand,
} from '../runner-client.ts';
import {
  ensureXctestrun,
  resolveExpectedRunnerCacheMetadata,
  resolveRunnerCacheMetadataPath,
  resolveRunnerPerformanceBuildSettings,
  shouldDeleteRunnerDerivedRootEntry,
  writeRunnerCacheMetadata,
  xctestrunReferencesProjectRoot,
} from '../runner-xctestrun.ts';
import { xctestrunReferencesExistingProducts } from '../runner-xctestrun-products.ts';
import { parseRunnerResponse } from '../runner-session.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

const iosDevice: DeviceInfo = {
  platform: 'ios',
  id: '00008110-000E12341234002E',
  name: 'iPhone',
  kind: 'device',
  booted: true,
};

const tvOsSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'tv-sim-1',
  name: 'Apple TV',
  kind: 'simulator',
  target: 'tv',
  booted: true,
};

const tvOsDevice: DeviceInfo = {
  platform: 'ios',
  id: '00008120-000E12341234003F',
  name: 'Apple TV',
  kind: 'device',
  target: 'tv',
  booted: true,
};

const macOsDevice: DeviceInfo = {
  platform: 'macos',
  id: 'host-macos-local',
  name: 'Host Mac',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

const runnerProtocolCommandFixtures: Record<RunnerCommand['command'], RunnerCommand> = {
  tap: { command: 'tap', x: 120, y: 240 },
  mouseClick: { command: 'mouseClick', x: 120, y: 240, button: 'secondary' },
  tapSeries: { command: 'tapSeries', x: 120, y: 240, count: 2, intervalMs: 80 },
  longPress: { command: 'longPress', x: 120, y: 240, durationMs: 750 },
  interactionFrame: { command: 'interactionFrame' },
  drag: { command: 'drag', x: 120, y: 240, x2: 300, y2: 420, durationMs: 400 },
  dragSeries: {
    command: 'dragSeries',
    x: 120,
    y: 240,
    x2: 300,
    y2: 420,
    count: 2,
    pauseMs: 100,
    pattern: 'ping-pong',
  },
  remotePress: { command: 'remotePress', remoteButton: 'down', durationMs: 250 },
  type: { command: 'type', text: 'hello', delayMs: 20, textEntryMode: 'replace' },
  swipe: { command: 'swipe', direction: 'down', durationMs: 250 },
  findText: { command: 'findText', text: 'Settings' },
  querySelector: { command: 'querySelector', selectorKey: 'id', selectorValue: 'submit' },
  readText: { command: 'readText' },
  snapshot: {
    command: 'snapshot',
    interactiveOnly: true,
    compact: true,
    depth: 2,
    scope: 'app',
    raw: false,
  },
  screenshot: { command: 'screenshot', outPath: '/tmp/runner-screenshot.png', fullscreen: true },
  back: { command: 'back' },
  backInApp: { command: 'backInApp' },
  backSystem: { command: 'backSystem' },
  home: { command: 'home' },
  rotate: { command: 'rotate', orientation: 'landscape-left' },
  appSwitcher: { command: 'appSwitcher' },
  keyboardDismiss: { command: 'keyboardDismiss' },
  alert: { command: 'alert', action: 'accept' },
  pinch: { command: 'pinch', scale: 0.5 },
  rotateGesture: { command: 'rotateGesture', degrees: 35, x: 200, y: 420, velocity: 1 },
  transformGesture: {
    command: 'transformGesture',
    x: 200,
    y: 420,
    dx: 80,
    dy: -40,
    scale: 2,
    degrees: 35,
    durationMs: 700,
  },
  recordStart: {
    command: 'recordStart',
    outPath: '/tmp/runner-recording.mp4',
    fps: 30,
    quality: 7,
  },
  recordStop: { command: 'recordStop' },
  uptime: { command: 'uptime' },
  shutdown: { command: 'shutdown' },
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../');

async function makeTmpDir(): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-xctestrun-'));
  onTestFinished(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });
  return tmpDir;
}

async function makeProjectTmpDir(): Promise<string> {
  const tmpRoot = path.join(repoRoot, '.tmp');
  await fs.promises.mkdir(tmpRoot, { recursive: true });
  const tmpDir = await fs.promises.mkdtemp(path.join(tmpRoot, 'agent-device-xctestrun-'));
  onTestFinished(async () => {
    await fs.promises.rm(tmpDir, { recursive: true, force: true });
  });
  return tmpDir;
}

function writeXctestrunFixture(
  xctestrunPath: string,
  options: { projectRoot: string; productRelativePaths: string[] },
): void {
  const entries = options.productRelativePaths
    .map((relativePath) => `        <string>__TESTROOT__/${relativePath}</string>`)
    .join('\n');
  fs.mkdirSync(path.dirname(xctestrunPath), { recursive: true });
  fs.writeFileSync(
    xctestrunPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>ProjectRootHint</key>
  <string>${options.projectRoot}</string>
  <key>ProductPaths</key>
  <array>
${entries}
  </array>
</dict>
</plist>`,
    'utf8',
  );
}

async function makeXctestrunProductsFixture(): Promise<{
  debugDir: string;
  xctestrunPath: string;
}> {
  const tmpDir = await makeTmpDir();
  const productsDir = path.join(tmpDir, 'Build', 'Products');
  return {
    debugDir: path.join(productsDir, 'Debug'),
    xctestrunPath: path.join(productsDir, 'AgentDeviceRunner.xctestrun'),
  };
}

function writeProductReferenceXctestrun(xctestrunPath: string, entries: string[]): void {
  fs.writeFileSync(
    xctestrunPath,
    ['<plist><dict>', ...entries, '</dict></plist>'].join(''),
    'utf8',
  );
}

async function makeBasicProductReferenceXctestrun(options: {
  includeRunnerHostBundle: boolean;
}): Promise<string> {
  const { debugDir, xctestrunPath } = await makeXctestrunProductsFixture();
  await fs.promises.mkdir(path.join(debugDir, 'AgentDeviceRunner.app'), { recursive: true });
  if (options.includeRunnerHostBundle) {
    await fs.promises.mkdir(
      path.join(
        debugDir,
        'AgentDeviceRunnerUITests-Runner.app',
        'Contents',
        'PlugIns',
        'AgentDeviceRunnerUITests.xctest',
      ),
      { recursive: true },
    );
  }
  writeProductReferenceXctestrun(xctestrunPath, [
    '<key>ProductPaths</key><array>',
    '<string>__TESTROOT__/Debug/AgentDeviceRunner.app</string>',
    '<string>__TESTROOT__/Debug/AgentDeviceRunnerUITests-Runner.app</string>',
    '</array>',
    '<key>TestHostPath</key><string>__TESTROOT__/Debug/AgentDeviceRunnerUITests-Runner.app</string>',
    '<key>TestBundlePath</key><string>__TESTHOST__/Contents/PlugIns/AgentDeviceRunnerUITests.xctest</string>',
  ]);
  return xctestrunPath;
}

function withRunnerDerivedPathEnv(derivedPath: string): void {
  const previousDerivedPath = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH;
  process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH = derivedPath;
  onTestFinished(() => {
    restoreEnvVar('AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH', previousDerivedPath);
  });
}

function restoreEnvVar(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function stripRunnerCacheArtifacts(metadata: Record<string, unknown>): Record<string, unknown> {
  const { artifacts: _artifacts, ...rest } = metadata;
  return rest;
}

function writeRunnerCacheMetadataWithArtifacts(params: {
  derivedPath: string;
  device: DeviceInfo;
  xctestrunPath: string;
  productPaths: string[];
}): void {
  fs.writeFileSync(
    resolveRunnerCacheMetadataPath(params.derivedPath),
    JSON.stringify(
      {
        ...resolveExpectedRunnerCacheMetadata(params.device, repoRoot),
        artifacts: {
          xctestrunPath: params.xctestrunPath,
          xctestrunMtimeMs: Math.trunc(fs.statSync(params.xctestrunPath).mtimeMs),
          productPaths: params.productPaths.map((productPath) => ({
            path: productPath,
            mtimeMs: Math.trunc(fs.statSync(productPath).mtimeMs),
          })),
        },
      },
      null,
      2,
    ),
  );
}

async function makeCachedRunnerXctestrun(): Promise<{
  derivedPath: string;
  existingXctestrunPath: string;
}> {
  const tmpDir = await makeProjectTmpDir();
  const derivedPath = path.join(tmpDir, 'custom-derived');
  const existingXctestrunPath = path.join(derivedPath, 'existing.xctestrun');
  await fs.promises.mkdir(derivedPath, { recursive: true });
  await fs.promises.mkdir(path.join(derivedPath, 'Runner.app'), { recursive: true });
  writeXctestrunFixture(existingXctestrunPath, {
    projectRoot: repoRoot,
    productRelativePaths: ['Runner.app'],
  });
  writeRunnerCacheMetadata(derivedPath, resolveExpectedRunnerCacheMetadata(macOsDevice, repoRoot));
  return { derivedPath, existingXctestrunPath };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockRunCmdStreaming.mockResolvedValue(undefined);
  mockRepairMacOsRunnerProductsIfNeeded.mockResolvedValue(undefined);
});

test('resolveRunnerDestination uses simulator destination for simulators', () => {
  assert.equal(resolveRunnerDestination(iosSimulator), 'platform=iOS Simulator,id=sim-1');
});

test('runner protocol fixtures cover every runner command with JSON-safe samples', () => {
  const commands = Object.keys(runnerProtocolCommandFixtures).sort();
  assert.deepEqual(commands, [
    'alert',
    'appSwitcher',
    'back',
    'backInApp',
    'backSystem',
    'drag',
    'dragSeries',
    'findText',
    'home',
    'interactionFrame',
    'keyboardDismiss',
    'longPress',
    'mouseClick',
    'pinch',
    'querySelector',
    'readText',
    'recordStart',
    'recordStop',
    'remotePress',
    'rotate',
    'rotateGesture',
    'screenshot',
    'shutdown',
    'snapshot',
    'swipe',
    'tap',
    'tapSeries',
    'transformGesture',
    'type',
    'uptime',
  ]);

  const roundTrip = JSON.parse(JSON.stringify(runnerProtocolCommandFixtures)) as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(roundTrip.tap.command, 'tap');
  assert.equal(roundTrip.mouseClick.button, 'secondary');
  assert.equal(roundTrip.snapshot.scope, 'app');
  assert.equal(roundTrip.screenshot.fullscreen, true);
  assert.equal(roundTrip.rotate.orientation, 'landscape-left');
  assert.equal(roundTrip.recordStart.fps, 30);
  assert.equal(roundTrip.recordStart.quality, 7);
});

test('resolveRunnerDestination uses device destination for physical devices', () => {
  assert.equal(resolveRunnerDestination(iosDevice), 'platform=iOS,id=00008110-000E12341234002E');
});

test('resolveRunnerBuildDestination uses generic iOS destination for physical devices', () => {
  assert.equal(resolveRunnerBuildDestination(iosDevice), 'generic/platform=iOS');
});

test('resolveRunnerDestination uses tvOS simulator destination for tvOS simulators', () => {
  assert.equal(resolveRunnerDestination(tvOsSimulator), 'platform=tvOS Simulator,id=tv-sim-1');
});

test('resolveRunnerDestination uses tvOS destination for tvOS devices', () => {
  assert.equal(resolveRunnerDestination(tvOsDevice), 'platform=tvOS,id=00008120-000E12341234003F');
});

test('resolveRunnerBuildDestination uses tvOS destinations for tvOS devices and simulators', () => {
  assert.equal(resolveRunnerBuildDestination(tvOsSimulator), 'platform=tvOS Simulator,id=tv-sim-1');
  assert.equal(resolveRunnerBuildDestination(tvOsDevice), 'generic/platform=tvOS');
});

test('isReadOnlyRunnerCommand treats interactionFrame as read-only', () => {
  assert.equal(isReadOnlyRunnerCommand('interactionFrame'), true);
});

test('resolveRunnerMaxConcurrentDestinationsFlag uses simulator flag for simulators', () => {
  assert.equal(
    resolveRunnerMaxConcurrentDestinationsFlag(iosSimulator),
    '-maximum-concurrent-test-simulator-destinations',
  );
});

test('resolveRunnerMaxConcurrentDestinationsFlag uses device flag for physical devices', () => {
  assert.equal(
    resolveRunnerMaxConcurrentDestinationsFlag(iosDevice),
    '-maximum-concurrent-test-device-destinations',
  );
});

test('resolveRunnerMaxConcurrentDestinationsFlag uses device flag for macOS desktop', () => {
  assert.equal(
    resolveRunnerMaxConcurrentDestinationsFlag(macOsDevice),
    '-maximum-concurrent-test-device-destinations',
  );
});

test('resolveRunnerSigningBuildSettings returns empty args without env overrides', () => {
  assert.deepEqual(resolveRunnerSigningBuildSettings({}), []);
});

test('resolveRunnerSigningBuildSettings disables signing for macOS desktop builds', () => {
  assert.deepEqual(resolveRunnerSigningBuildSettings({}, true, 'macos'), [
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
    'DEVELOPMENT_TEAM=',
  ]);
});

test('resolveRunnerSigningBuildSettings enables automatic signing for device builds without forcing identity', () => {
  assert.deepEqual(resolveRunnerSigningBuildSettings({}, true), ['CODE_SIGN_STYLE=Automatic']);
});

test('resolveRunnerSigningBuildSettings ignores device signing overrides for simulator builds', () => {
  assert.deepEqual(
    resolveRunnerSigningBuildSettings(
      {
        AGENT_DEVICE_IOS_TEAM_ID: 'ABCDE12345',
        AGENT_DEVICE_IOS_SIGNING_IDENTITY: 'Apple Development',
        AGENT_DEVICE_IOS_PROVISIONING_PROFILE: 'My Profile',
      },
      false,
    ),
    [],
  );
});

test('resolveRunnerSigningBuildSettings applies optional overrides when provided', () => {
  const settings = resolveRunnerSigningBuildSettings(
    {
      AGENT_DEVICE_IOS_TEAM_ID: 'ABCDE12345',
      AGENT_DEVICE_IOS_SIGNING_IDENTITY: 'Apple Development',
      AGENT_DEVICE_IOS_PROVISIONING_PROFILE: 'My Profile',
    },
    true,
  );
  assert.deepEqual(settings, [
    'CODE_SIGN_STYLE=Automatic',
    'DEVELOPMENT_TEAM=ABCDE12345',
    'CODE_SIGN_IDENTITY=Apple Development',
    'PROVISIONING_PROFILE_SPECIFIER=My Profile',
  ]);
});

test('resolveRunnerPerformanceBuildSettings disables indexing and code coverage', () => {
  assert.deepEqual(resolveRunnerPerformanceBuildSettings(), [
    'COMPILER_INDEX_STORE_ENABLE=NO',
    'ENABLE_CODE_COVERAGE=NO',
  ]);
});

test('resolveRunnerBundleBuildSettings returns default bundle identifiers', () => {
  assert.deepEqual(resolveRunnerBundleBuildSettings({}), [
    'AGENT_DEVICE_IOS_RUNNER_APP_BUNDLE_ID=com.callstack.agentdevice.runner',
    'AGENT_DEVICE_IOS_RUNNER_TEST_BUNDLE_ID=com.callstack.agentdevice.runner.uitests',
  ]);
});

test('resolveRunnerBundleBuildSettings uses AGENT_DEVICE_IOS_BUNDLE_ID when provided', () => {
  assert.deepEqual(
    resolveRunnerBundleBuildSettings({
      AGENT_DEVICE_IOS_BUNDLE_ID: 'com.example.agent-device.runner',
    }),
    [
      'AGENT_DEVICE_IOS_RUNNER_APP_BUNDLE_ID=com.example.agent-device.runner',
      'AGENT_DEVICE_IOS_RUNNER_TEST_BUNDLE_ID=com.example.agent-device.runner.uitests',
    ],
  );
});

test('assertSafeDerivedCleanup allows cleaning when no override is set', () => {
  assert.doesNotThrow(() => {
    assertSafeDerivedCleanup('/tmp/derived', {});
  });
});

test('assertSafeDerivedCleanup rejects cleaning override path by default', () => {
  assert.throws(() => {
    assertSafeDerivedCleanup('/tmp/custom', {
      AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: '/tmp/custom',
    });
  }, /Refusing to clean AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH automatically/);
});

test('assertSafeDerivedCleanup allows cleaning override path under project .tmp', () => {
  const derivedPath = path.join(repoRoot, '.tmp', 'ios-runner-derived');
  assert.doesNotThrow(() => {
    assertSafeDerivedCleanup(derivedPath, {
      AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: derivedPath,
    });
  });
});

test('resolveRunnerEarlyExitHint surfaces busy-connecting guidance', () => {
  const hint = resolveRunnerEarlyExitHint(
    'Runner did not accept connection (xcodebuild exited early)',
    'Ineligible destinations for the "AgentDeviceRunner" scheme:\n{ error:Device is busy (Connecting to iPhone) }',
    '',
  );
  assert.match(hint, /still connecting/i);
});

test('resolveRunnerEarlyExitHint falls back to runner connect timeout hint', () => {
  const hint = resolveRunnerEarlyExitHint(
    'Runner did not accept connection (xcodebuild exited early)',
    '',
    'xcodebuild failed unexpectedly',
  );
  assert.match(hint, /retry runner startup/i);
  assert.match(hint, /pnpm clean:xcuitest/i);
});

test('resolveRunnerBuildFailureHint suggests cache cleanup for non-signing failures', () => {
  const hint = resolveRunnerBuildFailureHint(
    new AppError('COMMAND_FAILED', 'xcodebuild build-for-testing failed'),
  );

  assert.match(hint, /pnpm clean:xcuitest/i);
  assert.match(hint, /~\/\.agent-device\/ios-runner\/derived/i);
});

test('shouldRetryRunnerConnectError does not retry xcodebuild early-exit errors', () => {
  const err = new AppError(
    'COMMAND_FAILED',
    'Runner did not accept connection (xcodebuild exited early)',
  );
  assert.equal(shouldRetryRunnerConnectError(err), false);
});

test('shouldRetryRunnerConnectError retries transient connect errors', () => {
  const err = new AppError('COMMAND_FAILED', 'Runner endpoint probe failed');
  assert.equal(shouldRetryRunnerConnectError(err), true);
});

test('parseRunnerResponse preserves runner unsupported-operation codes', async () => {
  const response = new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: 'Unable to dismiss the iOS keyboard without a native dismiss gesture or control',
      },
    }),
  );
  const session = {
    ready: false,
  } as any;

  await assert.rejects(
    () => parseRunnerResponse(response, session, '/tmp/runner.log'),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'UNSUPPORTED_OPERATION');
      assert.match(error.message, /Unable to dismiss the iOS keyboard/i);
      return true;
    },
  );
});

test('isRetryableRunnerError does not retry xcodebuild early-exit errors', () => {
  const err = new AppError(
    'COMMAND_FAILED',
    'Runner did not accept connection (xcodebuild exited early)',
  );
  assert.equal(isRetryableRunnerError(err), false);
});

test('isRetryableRunnerError does not retry busy-connecting errors', () => {
  const err = new AppError('COMMAND_FAILED', 'Device is busy (Connecting to iPhone)');
  assert.equal(isRetryableRunnerError(err), false);
});

test('xctestrunReferencesProjectRoot rejects stale worktree artifacts', async () => {
  const tmpDir = await makeTmpDir();
  const xctestrunPath = path.join(tmpDir, 'AgentDeviceRunner.xctestrun');
  fs.writeFileSync(
    xctestrunPath,
    '<plist><dict><key>SourceFilesCommonPathPrefix</key><string>/tmp/other-worktree/agent-device/ios-runner/AgentDeviceRunner</string></dict></plist>',
    'utf8',
  );

  assert.equal(
    xctestrunReferencesProjectRoot(xctestrunPath, '/tmp/current-worktree/agent-device'),
    false,
  );
  assert.equal(
    xctestrunReferencesProjectRoot(xctestrunPath, '/tmp/other-worktree/agent-device'),
    true,
  );
});

test('xctestrunReferencesExistingProducts rejects missing runner host artifacts', async () => {
  const xctestrunPath = await makeBasicProductReferenceXctestrun({
    includeRunnerHostBundle: false,
  });

  assert.equal(await xctestrunReferencesExistingProducts(xctestrunPath), false);
});

test('xctestrunReferencesExistingProducts accepts xctestruns when referenced products exist', async () => {
  const xctestrunPath = await makeBasicProductReferenceXctestrun({
    includeRunnerHostBundle: true,
  });

  assert.equal(await xctestrunReferencesExistingProducts(xctestrunPath), true);
});

test('xctestrunReferencesExistingProducts parses nested plist fallback values from XML', async () => {
  const { debugDir, xctestrunPath } = await makeXctestrunProductsFixture();
  await fs.promises.mkdir(path.join(debugDir, 'AgentDeviceRunner.app'), { recursive: true });
  await fs.promises.mkdir(path.join(debugDir, 'Target.app'), { recursive: true });
  await fs.promises.mkdir(path.join(debugDir, 'Frameworks', 'Helper.framework'), {
    recursive: true,
  });
  await fs.promises.mkdir(
    path.join(
      debugDir,
      'AgentDeviceRunner.app',
      'Contents',
      'PlugIns',
      'AgentDeviceRunnerUITests.xctest',
    ),
    { recursive: true },
  );
  writeProductReferenceXctestrun(xctestrunPath, [
    '<key>TestConfigurations</key><array>',
    '<dict>',
    '<key>TestTargets</key><array>',
    '<dict>',
    '<key>ProductPaths</key><array>',
    '<string>__TESTROOT__/Debug/AgentDeviceRunner.app</string>',
    '</array>',
    '<key>DependentProductPaths</key><array>',
    '<string>__TESTROOT__/Debug/Frameworks/Helper.framework</string>',
    '</array>',
    '<key>TestHostPath</key><string>__TESTROOT__/Debug/AgentDeviceRunner.app</string>',
    '<key>TestBundlePath</key><string>__TESTHOST__/Contents/PlugIns/AgentDeviceRunnerUITests.xctest</string>',
    '<key>UITargetAppPath</key><string>__TESTROOT__/Debug/Target.app</string>',
    '</dict>',
    '</array>',
    '</dict>',
    '</array>',
  ]);

  assert.equal(await xctestrunReferencesExistingProducts(xctestrunPath), true);
});

test('ensureXctestrun rebuilds after cached macOS runner repair failure', async () => {
  // Cached runner artifacts can look reusable until ad-hoc repair fails; ensure we clean once,
  // rebuild, and return the repaired rebuilt xctestrun instead of looping on stale cache state.
  const projectRoot = repoRoot;
  const { derivedPath, existingXctestrunPath } = await makeCachedRunnerXctestrun();
  const projectPath = path.join(
    projectRoot,
    'ios-runner',
    'AgentDeviceRunner',
    'AgentDeviceRunner.xcodeproj',
  );

  const rebuiltXctestrunPath = path.join(derivedPath, 'rebuilt', 'rebuilt.xctestrun');

  withRunnerDerivedPathEnv(derivedPath);

  const repairedPaths: string[] = [];

  mockRepairMacOsRunnerProductsIfNeeded.mockImplementation(
    async (_device, _productPaths, xctestrunPath) => {
      repairedPaths.push(xctestrunPath);
      if (xctestrunPath === existingXctestrunPath) {
        throw new AppError('COMMAND_FAILED', 'cached runner is damaged', {
          reason: 'RUNNER_PRODUCT_REPAIR_FAILED',
        });
      }
    },
  );
  mockRunCmdStreaming.mockImplementation(async (command, args) => {
    assert.equal(command, 'xcodebuild');
    assert.ok(Array.isArray(args));
    assert.equal(args[args.indexOf('-project') + 1], projectPath);
    assert.equal(args[args.indexOf('-derivedDataPath') + 1], derivedPath);
    await fs.promises.mkdir(path.join(derivedPath, 'rebuilt', 'Runner.app'), { recursive: true });
    writeXctestrunFixture(rebuiltXctestrunPath, {
      projectRoot,
      productRelativePaths: ['Runner.app'],
    });
  });

  const result = await ensureXctestrun(macOsDevice, {});

  assert.equal(result, rebuiltXctestrunPath);
  assert.equal(mockRunCmdStreaming.mock.calls.length, 1);
  assert.equal(fs.existsSync(existingXctestrunPath), false);
  assert.deepEqual(repairedPaths, [existingXctestrunPath, rebuiltXctestrunPath]);
});

test('ensureXctestrun prefers validated cache manifest over recursive scan', async () => {
  const tmpDir = await makeTmpDir();
  const derivedPath = path.join(tmpDir, 'custom-derived');
  const manifestProductPath = path.join(derivedPath, 'ManifestRunner.app');
  const manifestXctestrunPath = path.join(derivedPath, 'manifest.xctestrun');
  const newerProductPath = path.join(derivedPath, 'NewerRunner.app');
  const newerXctestrunPath = path.join(derivedPath, 'newer.xctestrun');
  await fs.promises.mkdir(manifestProductPath, { recursive: true });
  await fs.promises.mkdir(newerProductPath, { recursive: true });
  writeXctestrunFixture(manifestXctestrunPath, {
    projectRoot: repoRoot,
    productRelativePaths: ['ManifestRunner.app'],
  });
  writeXctestrunFixture(newerXctestrunPath, {
    projectRoot: repoRoot,
    productRelativePaths: ['NewerRunner.app'],
  });
  const now = new Date();
  fs.utimesSync(manifestXctestrunPath, now, now);
  fs.utimesSync(
    newerXctestrunPath,
    new Date(now.getTime() + 5_000),
    new Date(now.getTime() + 5_000),
  );
  writeRunnerCacheMetadataWithArtifacts({
    derivedPath,
    device: macOsDevice,
    xctestrunPath: manifestXctestrunPath,
    productPaths: [manifestProductPath],
  });
  withRunnerDerivedPathEnv(derivedPath);

  const result = await ensureXctestrun(macOsDevice, {});

  assert.equal(result, manifestXctestrunPath);
  assert.equal(mockRunCmdStreaming.mock.calls.length, 0);
  assert.deepEqual(mockRepairMacOsRunnerProductsIfNeeded.mock.calls[0]?.[1], [manifestProductPath]);
});

test('ensureXctestrun falls back to scan when cache manifest is stale', async () => {
  const tmpDir = await makeTmpDir();
  const derivedPath = path.join(tmpDir, 'custom-derived');
  const manifestProductPath = path.join(derivedPath, 'ManifestRunner.app');
  const manifestXctestrunPath = path.join(derivedPath, 'manifest.xctestrun');
  const newerProductPath = path.join(derivedPath, 'NewerRunner.app');
  const newerXctestrunPath = path.join(derivedPath, 'newer.xctestrun');
  await fs.promises.mkdir(manifestProductPath, { recursive: true });
  await fs.promises.mkdir(newerProductPath, { recursive: true });
  writeXctestrunFixture(manifestXctestrunPath, {
    projectRoot: repoRoot,
    productRelativePaths: ['ManifestRunner.app'],
  });
  writeXctestrunFixture(newerXctestrunPath, {
    projectRoot: repoRoot,
    productRelativePaths: ['NewerRunner.app'],
  });
  const now = new Date();
  fs.utimesSync(manifestXctestrunPath, now, now);
  fs.utimesSync(
    newerXctestrunPath,
    new Date(now.getTime() + 5_000),
    new Date(now.getTime() + 5_000),
  );
  writeRunnerCacheMetadataWithArtifacts({
    derivedPath,
    device: macOsDevice,
    xctestrunPath: manifestXctestrunPath,
    productPaths: [manifestProductPath],
  });
  fs.utimesSync(
    manifestProductPath,
    new Date(now.getTime() + 10_000),
    new Date(now.getTime() + 10_000),
  );
  withRunnerDerivedPathEnv(derivedPath);

  const result = await ensureXctestrun(macOsDevice, {});

  assert.equal(result, newerXctestrunPath);
  assert.equal(mockRunCmdStreaming.mock.calls.length, 0);
  assert.deepEqual(mockRepairMacOsRunnerProductsIfNeeded.mock.calls[0]?.[1], [newerProductPath]);
});

test('ensureXctestrun rebuilds cached runner when metadata package version mismatches', async () => {
  const projectRoot = repoRoot;
  const { derivedPath, existingXctestrunPath } = await makeCachedRunnerXctestrun();
  const metadataPath = resolveRunnerCacheMetadataPath(derivedPath);
  const staleMetadata = {
    ...resolveExpectedRunnerCacheMetadata(macOsDevice, repoRoot),
    packageVersion: '0.0.0-stale',
  };
  fs.writeFileSync(metadataPath, JSON.stringify(staleMetadata, null, 2));

  const rebuiltXctestrunPath = path.join(derivedPath, 'rebuilt', 'rebuilt.xctestrun');

  withRunnerDerivedPathEnv(derivedPath);

  mockRunCmdStreaming.mockImplementation(async () => {
    await fs.promises.mkdir(path.join(derivedPath, 'rebuilt', 'Runner.app'), { recursive: true });
    writeXctestrunFixture(rebuiltXctestrunPath, {
      projectRoot,
      productRelativePaths: ['Runner.app'],
    });
  });

  const result = await ensureXctestrun(macOsDevice, {});

  assert.equal(result, rebuiltXctestrunPath);
  assert.equal(mockRunCmdStreaming.mock.calls.length, 1);
  assert.equal(fs.existsSync(existingXctestrunPath), false);
  const rebuiltMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  assert.deepEqual(
    stripRunnerCacheArtifacts(rebuiltMetadata),
    resolveExpectedRunnerCacheMetadata(macOsDevice, repoRoot),
  );
  assert.equal(rebuiltMetadata.artifacts?.xctestrunPath, rebuiltXctestrunPath);
});

test('ensureXctestrun rethrows unexpected cached macOS runner repair errors', async () => {
  const { derivedPath, existingXctestrunPath } = await makeCachedRunnerXctestrun();

  withRunnerDerivedPathEnv(derivedPath);

  mockRepairMacOsRunnerProductsIfNeeded.mockRejectedValue(new Error('permission denied'));

  await assert.rejects(ensureXctestrun(macOsDevice, {}), /permission denied/);
  assert.equal(mockRunCmdStreaming.mock.calls.length, 0);
  assert.equal(fs.existsSync(existingXctestrunPath), true);
});

test('shouldDeleteRunnerDerivedRootEntry only removes known xcode transient entries', () => {
  assert.equal(shouldDeleteRunnerDerivedRootEntry('Build'), true);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('Logs'), true);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('Index.noindex'), true);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('device'), false);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('macos'), false);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('visionos'), false);
});
