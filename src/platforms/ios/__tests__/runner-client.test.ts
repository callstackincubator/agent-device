import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DeviceInfo } from '../../../utils/device.ts';
import { AppError } from '../../../utils/errors.ts';
import {
  assertSafeDerivedCleanup,
  isRetryableRunnerError,
  resolveRunnerEarlyExitHint,
  resolveRunnerBuildDestination,
  resolveRunnerBundleBuildSettings,
  resolveRunnerDestination,
  resolveRunnerMaxConcurrentDestinationsFlag,
  resolveRunnerSigningBuildSettings,
  shouldRetryRunnerConnectError,
} from '../runner-client.ts';
import {
  ensureXctestrun,
  resolveRunnerPerformanceBuildSettings,
  shouldDeleteRunnerDerivedRootEntry,
  xctestrunReferencesExistingProducts,
  xctestrunReferencesProjectRoot,
} from '../runner-xctestrun.ts';

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

test('resolveRunnerDestination uses simulator destination for simulators', () => {
  assert.equal(resolveRunnerDestination(iosSimulator), 'platform=iOS Simulator,id=sim-1');
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

test('assertSafeDerivedCleanup allows cleaning override path with explicit opt-in', () => {
  assert.doesNotThrow(() => {
    assertSafeDerivedCleanup('/tmp/custom', {
      AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: '/tmp/custom',
      AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN: '1',
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
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-xctestrun-'));
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
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-xctestrun-'));
  const productsDir = path.join(tmpDir, 'Build', 'Products');
  const debugDir = path.join(productsDir, 'Debug');
  await fs.promises.mkdir(path.join(debugDir, 'AgentDeviceRunner.app'), { recursive: true });
  const xctestrunPath = path.join(productsDir, 'AgentDeviceRunner.xctestrun');
  fs.writeFileSync(
    xctestrunPath,
    [
      '<plist><dict>',
      '<key>ProductPaths</key><array>',
      '<string>__TESTROOT__/Debug/AgentDeviceRunner.app</string>',
      '<string>__TESTROOT__/Debug/AgentDeviceRunnerUITests-Runner.app</string>',
      '</array>',
      '<key>TestHostPath</key><string>__TESTROOT__/Debug/AgentDeviceRunnerUITests-Runner.app</string>',
      '<key>TestBundlePath</key><string>__TESTHOST__/Contents/PlugIns/AgentDeviceRunnerUITests.xctest</string>',
      '</dict></plist>',
    ].join(''),
    'utf8',
  );

  assert.equal(xctestrunReferencesExistingProducts(xctestrunPath), false);
});

test('xctestrunReferencesExistingProducts accepts xctestruns when referenced products exist', async () => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-xctestrun-'));
  const productsDir = path.join(tmpDir, 'Build', 'Products');
  const debugDir = path.join(productsDir, 'Debug');
  await fs.promises.mkdir(path.join(debugDir, 'AgentDeviceRunner.app'), { recursive: true });
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
  const xctestrunPath = path.join(productsDir, 'AgentDeviceRunner.xctestrun');
  fs.writeFileSync(
    xctestrunPath,
    [
      '<plist><dict>',
      '<key>ProductPaths</key><array>',
      '<string>__TESTROOT__/Debug/AgentDeviceRunner.app</string>',
      '<string>__TESTROOT__/Debug/AgentDeviceRunnerUITests-Runner.app</string>',
      '</array>',
      '<key>TestHostPath</key><string>__TESTROOT__/Debug/AgentDeviceRunnerUITests-Runner.app</string>',
      '<key>TestBundlePath</key><string>__TESTHOST__/Contents/PlugIns/AgentDeviceRunnerUITests.xctest</string>',
      '</dict></plist>',
    ].join(''),
    'utf8',
  );

  assert.equal(xctestrunReferencesExistingProducts(xctestrunPath), true);
});

test('ensureXctestrun rebuilds after cached macOS runner repair failure', async (t) => {
  // Cached runner artifacts can look reusable until ad-hoc repair fails; ensure we clean once,
  // rebuild, and return the repaired rebuilt xctestrun instead of looping on stale cache state.
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-xctestrun-'));
  const projectRoot = path.join(tmpDir, 'project');
  const derivedPath = path.join(tmpDir, 'derived');
  const projectPath = path.join(
    projectRoot,
    'ios-runner',
    'AgentDeviceRunner',
    'AgentDeviceRunner.xcodeproj',
  );
  await fs.promises.mkdir(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, '', 'utf8');

  const existingXctestrunPath = path.join(derivedPath, 'existing.xctestrun');
  const rebuiltXctestrunPath = path.join(derivedPath, 'rebuilt.xctestrun');
  await fs.promises.mkdir(derivedPath, { recursive: true });
  fs.writeFileSync(existingXctestrunPath, 'existing', 'utf8');

  const previousDerivedPath = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH;
  process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH = derivedPath;
  t.after(() => {
    if (previousDerivedPath === undefined) {
      delete process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH;
      return;
    }
    process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH = previousDerivedPath;
  });

  let currentXctestrunPath = existingXctestrunPath;
  let cleanCalls = 0;
  let buildCalls = 0;
  const repairedPaths: string[] = [];

  const result = await ensureXctestrun(
    macOsDevice,
    {},
    {
      findProjectRoot: () => projectRoot,
      findXctestrun: () => currentXctestrunPath,
      xctestrunReferencesProjectRoot: () => true,
      resolveExistingXctestrunProductPaths: () => ['/tmp/runner.app'],
      repairRunnerProductsIfNeeded: async (_device, _productPaths, xctestrunPath) => {
        repairedPaths.push(xctestrunPath);
        if (xctestrunPath === existingXctestrunPath) {
          throw new AppError('COMMAND_FAILED', 'cached runner is damaged', {
            reason: 'RUNNER_PRODUCT_REPAIR_FAILED',
          });
        }
      },
      assertSafeDerivedCleanup: (targetPath) => {
        assert.equal(targetPath, derivedPath);
      },
      cleanRunnerDerivedArtifacts: (targetPath) => {
        assert.equal(targetPath, derivedPath);
        cleanCalls += 1;
      },
      buildRunnerXctestrun: async (_device, targetProjectPath, targetDerivedPath) => {
        assert.equal(targetProjectPath, projectPath);
        assert.equal(targetDerivedPath, derivedPath);
        buildCalls += 1;
        currentXctestrunPath = rebuiltXctestrunPath;
        fs.writeFileSync(rebuiltXctestrunPath, 'rebuilt', 'utf8');
      },
    },
  );

  assert.equal(result, rebuiltXctestrunPath);
  assert.equal(cleanCalls, 1);
  assert.equal(buildCalls, 1);
  assert.deepEqual(repairedPaths, [existingXctestrunPath, rebuiltXctestrunPath]);
});

test('ensureXctestrun rethrows unexpected cached macOS runner repair errors', async (t) => {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'agent-device-xctestrun-'));
  const projectRoot = path.join(tmpDir, 'project');
  const derivedPath = path.join(tmpDir, 'derived');
  const projectPath = path.join(
    projectRoot,
    'ios-runner',
    'AgentDeviceRunner',
    'AgentDeviceRunner.xcodeproj',
  );
  await fs.promises.mkdir(path.dirname(projectPath), { recursive: true });
  fs.writeFileSync(projectPath, '', 'utf8');

  const existingXctestrunPath = path.join(derivedPath, 'existing.xctestrun');
  await fs.promises.mkdir(derivedPath, { recursive: true });
  fs.writeFileSync(existingXctestrunPath, 'existing', 'utf8');

  const previousDerivedPath = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH;
  process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH = derivedPath;
  t.after(() => {
    if (previousDerivedPath === undefined) {
      delete process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH;
      return;
    }
    process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH = previousDerivedPath;
  });

  await assert.rejects(
    ensureXctestrun(
      macOsDevice,
      {},
      {
        findProjectRoot: () => projectRoot,
        findXctestrun: () => existingXctestrunPath,
        xctestrunReferencesProjectRoot: () => true,
        resolveExistingXctestrunProductPaths: () => ['/tmp/runner.app'],
        repairRunnerProductsIfNeeded: async () => {
          throw new Error('permission denied');
        },
        assertSafeDerivedCleanup: () => {
          throw new Error('should not clean derived data for unexpected repair errors');
        },
        cleanRunnerDerivedArtifacts: () => {
          throw new Error('should not rebuild for unexpected repair errors');
        },
        buildRunnerXctestrun: async () => {
          throw new Error('should not rebuild for unexpected repair errors');
        },
      },
    ),
    /permission denied/,
  );
});

test('shouldDeleteRunnerDerivedRootEntry only removes known xcode transient entries', () => {
  assert.equal(shouldDeleteRunnerDerivedRootEntry('Build'), true);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('Logs'), true);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('Index.noindex'), true);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('device'), false);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('macos'), false);
  assert.equal(shouldDeleteRunnerDerivedRootEntry('visionos'), false);
});
