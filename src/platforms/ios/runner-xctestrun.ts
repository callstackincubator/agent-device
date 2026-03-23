import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/errors.ts';
import {
  runCmd,
  runCmdSync,
  runCmdStreaming,
  type ExecBackgroundResult,
} from '../../utils/exec.ts';
import { isEnvTruthy } from '../../utils/retry.ts';
import { resolveApplePlatformName, type DeviceInfo } from '../../utils/device.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { resolveSigningFailureHint } from './runner-errors.ts';
import { logChunk } from './runner-transport.ts';

const DEFAULT_IOS_RUNNER_APP_BUNDLE_ID = 'com.callstack.agentdevice.runner';

const RUNNER_DERIVED_ROOT = path.join(os.homedir(), '.agent-device', 'ios-runner');

const runnerXctestrunBuildLocks = new Map<string, Promise<unknown>>();
export const runnerPrepProcesses = new Set<ExecBackgroundResult['child']>();

function normalizeBundleId(value: string | undefined): string {
  return value?.trim() ?? '';
}

function resolveRunnerAppBundleId(env: NodeJS.ProcessEnv = process.env): string {
  const configured =
    normalizeBundleId(env.AGENT_DEVICE_IOS_BUNDLE_ID) ||
    normalizeBundleId(env.AGENT_DEVICE_IOS_RUNNER_APP_BUNDLE_ID);
  return configured || DEFAULT_IOS_RUNNER_APP_BUNDLE_ID;
}

function resolveRunnerTestBundleId(env: NodeJS.ProcessEnv = process.env): string {
  const configured = normalizeBundleId(env.AGENT_DEVICE_IOS_RUNNER_TEST_BUNDLE_ID);
  if (configured) {
    return configured;
  }
  return `${resolveRunnerAppBundleId(env)}.uitests`;
}

function resolveRunnerContainerBundleIds(env: NodeJS.ProcessEnv = process.env): string[] {
  const appBundleId = resolveRunnerAppBundleId(env);
  const testBundleId = resolveRunnerTestBundleId(env);
  return Array.from(
    new Set(
      [
        normalizeBundleId(env.AGENT_DEVICE_IOS_RUNNER_CONTAINER_BUNDLE_ID),
        `${testBundleId}.xctrunner`,
        appBundleId,
      ].filter((id) => id.length > 0),
    ),
  );
}

export const IOS_RUNNER_CONTAINER_BUNDLE_IDS: string[] = resolveRunnerContainerBundleIds(
  process.env,
);

type EnsureXctestrunDeps = {
  findProjectRoot: () => string;
  findXctestrun: (root: string) => string | null;
  xctestrunReferencesProjectRoot: (xctestrunPath: string, projectRoot: string) => boolean;
  xctestrunReferencesExistingProducts: (xctestrunPath: string) => boolean;
  repairRunnerProductsIfNeeded: (device: DeviceInfo, xctestrunPath: string) => Promise<void>;
  assertSafeDerivedCleanup: (derivedPath: string) => void;
  cleanRunnerDerivedArtifacts: (derivedPath: string) => void;
  buildRunnerXctestrun: (
    device: DeviceInfo,
    projectPath: string,
    derived: string,
    options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
  ) => Promise<void>;
};

const defaultEnsureXctestrunDeps: EnsureXctestrunDeps = {
  findProjectRoot,
  findXctestrun,
  xctestrunReferencesProjectRoot,
  xctestrunReferencesExistingProducts,
  repairRunnerProductsIfNeeded: repairMacOsRunnerProductsIfNeeded,
  assertSafeDerivedCleanup,
  cleanRunnerDerivedArtifacts,
  buildRunnerXctestrun,
};

export async function ensureXctestrun(
  device: DeviceInfo,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
  deps: EnsureXctestrunDeps = defaultEnsureXctestrunDeps,
): Promise<string> {
  const derived = resolveRunnerDerivedPath(device);
  const projectRoot = deps.findProjectRoot();
  return await withKeyedLock(runnerXctestrunBuildLocks, derived, async () => {
    if (shouldCleanDerived()) {
      deps.assertSafeDerivedCleanup(derived);
      deps.cleanRunnerDerivedArtifacts(derived);
    }
    const existing = deps.findXctestrun(derived);
    const canReuseExisting =
      existing &&
      deps.xctestrunReferencesProjectRoot(existing, projectRoot) &&
      deps.xctestrunReferencesExistingProducts(existing);
    if (canReuseExisting) {
      try {
        await deps.repairRunnerProductsIfNeeded(device, existing);
        return existing;
      } catch {
        // Fall through and rebuild from a clean derived state.
      }
    }
    if (existing) {
      deps.assertSafeDerivedCleanup(derived);
      deps.cleanRunnerDerivedArtifacts(derived);
    }
    const projectPath = path.join(
      projectRoot,
      'ios-runner',
      'AgentDeviceRunner',
      'AgentDeviceRunner.xcodeproj',
    );

    if (!fs.existsSync(projectPath)) {
      throw new AppError('COMMAND_FAILED', 'iOS runner project not found', { projectPath });
    }

    await deps.buildRunnerXctestrun(device, projectPath, derived, options);

    const built = deps.findXctestrun(derived);
    if (!built) {
      throw new AppError('COMMAND_FAILED', 'Failed to locate .xctestrun after build');
    }
    if (!deps.xctestrunReferencesExistingProducts(built)) {
      throw new AppError('COMMAND_FAILED', 'Runner build is missing expected products', {
        xctestrunPath: built,
      });
    }
    await deps.repairRunnerProductsIfNeeded(device, built);
    return built;
  });
}

function cleanRunnerDerivedArtifacts(derived: string): void {
  try {
    if (!fs.existsSync(derived)) return;
    if (path.basename(derived) !== 'derived') {
      fs.rmSync(derived, { recursive: true, force: true });
      return;
    }
    for (const entry of fs.readdirSync(derived, { withFileTypes: true })) {
      if (!shouldDeleteRunnerDerivedRootEntry(entry.name)) continue;
      fs.rmSync(path.join(derived, entry.name), { recursive: true, force: true });
    }
  } catch {
    // ignore
  }
}

const RUNNER_ROOT_TRANSIENT_ENTRY_NAMES = new Set([
  'Build',
  'BuildCache.noindex',
  'Index.noindex',
  'Logs',
  'ModuleCache.noindex',
  'SDKStatCaches.noindex',
  'SourcePackages',
  'TextBasedInstallAPI',
  'info.plist',
]);

export function shouldDeleteRunnerDerivedRootEntry(entryName: string): boolean {
  return RUNNER_ROOT_TRANSIENT_ENTRY_NAMES.has(entryName);
}

function findXctestrun(root: string): string | null {
  if (!fs.existsSync(root)) return null;
  const candidates: { path: string; mtimeMs: number }[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.xctestrun')) {
        try {
          const stat = fs.statSync(full);
          candidates.push({ path: full, mtimeMs: stat.mtimeMs });
        } catch {
          // ignore
        }
      }
    }
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.path ?? null;
}

export function xctestrunReferencesProjectRoot(
  xctestrunPath: string,
  projectRoot: string,
): boolean {
  try {
    const contents = fs.readFileSync(xctestrunPath, 'utf8');
    const candidateRoots = new Set<string>([projectRoot]);
    try {
      candidateRoots.add(fs.realpathSync(projectRoot));
    } catch {
      // ignore
    }
    for (const root of candidateRoots) {
      if (contents.includes(root)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

export function xctestrunReferencesExistingProducts(xctestrunPath: string): boolean {
  try {
    return resolveXctestrunProductPaths(xctestrunPath) !== null;
  } catch {
    return false;
  }
}

type XctestrunProductRefs = {
  testRootPaths: string[];
  testHostPaths: string[];
};

type XctestrunResolvedProductPaths = {
  rootProductPaths: string[];
  hostProductPaths: string[];
};

function readXctestrunJson(xctestrunPath: string): Record<string, unknown> | null {
  try {
    const result = runCmdSync('plutil', ['-convert', 'json', '-o', '-', xctestrunPath], {
      allowFailure: true,
    });
    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return null;
    }
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function resolveXctestrunProductRefsFromJson(
  parsed: Record<string, unknown>,
): XctestrunProductRefs {
  const testRootPaths: string[] = [];
  const testHostPaths: string[] = [];
  const productPathKeys = new Set([
    'ProductPaths',
    'DependentProductPaths',
    'TestHostPath',
    'TestBundlePath',
    'UITargetAppPath',
  ]);

  const visit = (value: unknown, key?: string) => {
    if (typeof value === 'string') {
      if (!key || !productPathKeys.has(key)) {
        return;
      }
      if (value.startsWith('__TESTROOT__/')) {
        testRootPaths.push(value.slice('__TESTROOT__/'.length));
      } else if (value.startsWith('__TESTHOST__/')) {
        testHostPaths.push(value.slice('__TESTHOST__/'.length));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item, key);
      }
      return;
    }
    if (!value || typeof value !== 'object') {
      return;
    }
    for (const [childKey, childValue] of Object.entries(value)) {
      visit(childValue, childKey);
    }
  };

  visit(parsed);
  return {
    testRootPaths: Array.from(new Set(testRootPaths)),
    testHostPaths: Array.from(new Set(testHostPaths)),
  };
}

function resolveXctestrunProductRefsFromXml(contents: string): XctestrunProductRefs {
  const arrayPathKeys = ['ProductPaths', 'DependentProductPaths'];
  const stringPathKeys = ['TestHostPath', 'TestBundlePath', 'UITargetAppPath'];
  const values = [
    ...arrayPathKeys.flatMap((key) => extractPlistArrayStringValues(contents, key)),
    ...stringPathKeys.flatMap((key) => extractPlistStringValues(contents, key)),
  ];
  return {
    testRootPaths: Array.from(
      new Set(
        values
          .filter((value) => value.startsWith('__TESTROOT__/'))
          .map((value) => value.slice('__TESTROOT__/'.length)),
      ),
    ),
    testHostPaths: Array.from(
      new Set(
        values
          .filter((value) => value.startsWith('__TESTHOST__/'))
          .map((value) => value.slice('__TESTHOST__/'.length)),
      ),
    ),
  };
}

function resolveXctestrunProductPaths(xctestrunPath: string): XctestrunResolvedProductPaths | null {
  const refs = resolveXctestrunProductRefs(xctestrunPath);
  if (!refs || (refs.testRootPaths.length === 0 && refs.testHostPaths.length === 0)) {
    return null;
  }
  const testRoot = path.dirname(xctestrunPath);
  const rootProductPaths = refs.testRootPaths.map((relativePath) =>
    path.join(testRoot, relativePath),
  );
  for (const productPath of rootProductPaths) {
    if (!fs.existsSync(productPath)) {
      return null;
    }
  }

  const testHostRoots = Array.from(
    new Set(
      refs.testRootPaths
        .map(extractAppBundleRoot)
        .filter((relativePath): relativePath is string => relativePath !== null),
    ),
  );
  const hostProductPaths: string[] = [];
  for (const relativePath of refs.testHostPaths) {
    const resolvedHostPath = testHostRoots
      .map((hostRoot) => path.join(testRoot, hostRoot, relativePath))
      .find((candidatePath) => fs.existsSync(candidatePath));
    if (!resolvedHostPath) {
      return null;
    }
    hostProductPaths.push(resolvedHostPath);
  }

  return {
    rootProductPaths: Array.from(new Set(rootProductPaths)),
    hostProductPaths: Array.from(new Set(hostProductPaths)),
  };
}

function resolveXctestrunProductRefs(xctestrunPath: string): XctestrunProductRefs | null {
  const parsed = readXctestrunJson(xctestrunPath);
  if (parsed) {
    return resolveXctestrunProductRefsFromJson(parsed);
  }
  try {
    return resolveXctestrunProductRefsFromXml(fs.readFileSync(xctestrunPath, 'utf8'));
  } catch {
    return null;
  }
}

function extractPlistStringValues(contents: string, key: string): string[] {
  const pattern = new RegExp(`<key>${key}</key>\\s*<string>([\\s\\S]*?)</string>`, 'g');
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(contents)) !== null) {
    const value = match[1]?.trim();
    if (value) {
      values.add(value);
    }
  }
  return Array.from(values);
}

function findProjectRoot(): string {
  const start = path.dirname(fileURLToPath(import.meta.url));
  let current = start;
  for (let i = 0; i < 6; i += 1) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) return current;
    current = path.dirname(current);
  }
  return start;
}

function extractPlistArrayStringValues(contents: string, key: string): string[] {
  const blockPattern = new RegExp(`<key>${key}</key>\\s*<array>([\\s\\S]*?)</array>`, 'g');
  const stringPattern = /<string>([\s\S]*?)<\/string>/g;
  const values = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(contents)) !== null) {
    const block = match[1] ?? '';
    let stringMatch: RegExpExecArray | null;
    while ((stringMatch = stringPattern.exec(block)) !== null) {
      const value = stringMatch[1]?.trim();
      if (value) {
        values.add(value);
      }
    }
  }
  return Array.from(values);
}

function extractAppBundleRoot(relativePath: string): string | null {
  const appIndex = relativePath.indexOf('.app');
  if (appIndex === -1) {
    return null;
  }
  return relativePath.slice(0, appIndex + '.app'.length);
}

export async function prepareXctestrunWithEnv(
  xctestrunPath: string,
  envVars: Record<string, string>,
  suffix: string,
): Promise<{ xctestrunPath: string; jsonPath: string }> {
  const dir = path.dirname(xctestrunPath);
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpJsonPath = path.join(dir, `AgentDeviceRunner.env.${safeSuffix}.json`);
  const tmpXctestrunPath = path.join(dir, `AgentDeviceRunner.env.${safeSuffix}.xctestrun`);

  const jsonResult = await runCmd('plutil', ['-convert', 'json', '-o', '-', xctestrunPath], {
    allowFailure: true,
  });
  if (jsonResult.exitCode !== 0 || !jsonResult.stdout.trim()) {
    throw new AppError('COMMAND_FAILED', 'Failed to read xctestrun plist', {
      xctestrunPath,
      stderr: jsonResult.stderr,
    });
  }

  let parsed: Record<string, any>;
  try {
    parsed = JSON.parse(jsonResult.stdout) as Record<string, any>;
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'Failed to parse xctestrun JSON', {
      xctestrunPath,
      error: String(err),
    });
  }

  const applyEnvToTarget = (target: Record<string, any>) => {
    target.EnvironmentVariables = { ...(target.EnvironmentVariables ?? {}), ...envVars };
    target.UITestEnvironmentVariables = {
      ...(target.UITestEnvironmentVariables ?? {}),
      ...envVars,
    };
    target.UITargetAppEnvironmentVariables = {
      ...(target.UITargetAppEnvironmentVariables ?? {}),
      ...envVars,
    };
    target.TestingEnvironmentVariables = {
      ...(target.TestingEnvironmentVariables ?? {}),
      ...envVars,
    };
  };

  const configs = parsed.TestConfigurations;
  if (Array.isArray(configs)) {
    for (const config of configs) {
      if (!config || typeof config !== 'object') continue;
      const targets = config.TestTargets;
      if (!Array.isArray(targets)) continue;
      for (const target of targets) {
        if (!target || typeof target !== 'object') continue;
        applyEnvToTarget(target);
      }
    }
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (value && typeof value === 'object' && value.TestBundlePath) {
      applyEnvToTarget(value);
      parsed[key] = value;
    }
  }

  fs.writeFileSync(tmpJsonPath, JSON.stringify(parsed, null, 2));
  const plistResult = await runCmd(
    'plutil',
    ['-convert', 'xml1', '-o', tmpXctestrunPath, tmpJsonPath],
    {
      allowFailure: true,
    },
  );
  if (plistResult.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to write xctestrun plist', {
      tmpXctestrunPath,
      stderr: plistResult.stderr,
    });
  }

  return { xctestrunPath: tmpXctestrunPath, jsonPath: tmpJsonPath };
}

async function buildRunnerXctestrun(
  device: DeviceInfo,
  projectPath: string,
  derived: string,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<void> {
  const runnerBundleBuildSettings = resolveRunnerBundleBuildSettings(process.env);
  const signingBuildSettings = resolveRunnerSigningBuildSettings(
    process.env,
    device.kind === 'device',
    device.platform,
  );
  const provisioningArgs = device.kind === 'device' ? ['-allowProvisioningUpdates'] : [];
  const performanceBuildSettings = resolveRunnerPerformanceBuildSettings();
  try {
    await runCmdStreaming(
      'xcodebuild',
      [
        'build-for-testing',
        '-project',
        projectPath,
        '-scheme',
        'AgentDeviceRunner',
        '-parallel-testing-enabled',
        'NO',
        resolveRunnerMaxConcurrentDestinationsFlag(device),
        '1',
        '-destination',
        resolveRunnerBuildDestination(device),
        '-derivedDataPath',
        derived,
        ...performanceBuildSettings,
        ...runnerBundleBuildSettings,
        ...provisioningArgs,
        ...signingBuildSettings,
      ],
      {
        detached: true,
        onSpawn: (child) => {
          runnerPrepProcesses.add(child);
          child.on('close', () => {
            runnerPrepProcesses.delete(child);
          });
        },
        onStdoutChunk: (chunk) => {
          logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
        },
        onStderrChunk: (chunk) => {
          logChunk(chunk, options.logPath, options.traceLogPath, options.verbose);
        },
      },
    );
  } catch (err) {
    const appErr = err instanceof AppError ? err : new AppError('COMMAND_FAILED', String(err));
    const hint = resolveSigningFailureHint(appErr);
    throw new AppError('COMMAND_FAILED', 'xcodebuild build-for-testing failed', {
      error: appErr.message,
      details: appErr.details,
      logPath: options.logPath,
      hint,
    });
  }
}

function resolveRunnerDerivedPath(device: DeviceInfo): string {
  const override = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (device.platform === 'macos') {
    return path.join(RUNNER_DERIVED_ROOT, 'derived', 'macos');
  }
  if (device.kind === 'simulator') {
    return path.join(RUNNER_DERIVED_ROOT, 'derived');
  }
  return path.join(RUNNER_DERIVED_ROOT, 'derived', device.kind);
}

export function resolveRunnerDestination(device: DeviceInfo): string {
  const platformName = resolveRunnerPlatformName(device);
  if (platformName === 'macOS') {
    return `platform=macOS,arch=${resolveMacRunnerArch()}`;
  }
  if (device.kind === 'simulator') {
    return `platform=${platformName} Simulator,id=${device.id}`;
  }
  return `platform=${platformName},id=${device.id}`;
}

export function resolveRunnerBuildDestination(device: DeviceInfo): string {
  const platformName = resolveRunnerPlatformName(device);
  if (platformName === 'macOS') {
    return `platform=macOS,arch=${resolveMacRunnerArch()}`;
  }
  if (device.kind === 'simulator') {
    return `platform=${platformName} Simulator,id=${device.id}`;
  }
  return `generic/platform=${platformName}`;
}

function resolveRunnerPlatformName(device: DeviceInfo): 'iOS' | 'tvOS' | 'macOS' {
  if (device.platform !== 'ios' && device.platform !== 'macos') {
    throw new AppError(
      'UNSUPPORTED_PLATFORM',
      `Unsupported platform for iOS runner: ${device.platform}`,
    );
  }
  if (device.platform === 'macos') {
    return 'macOS';
  }
  return resolveApplePlatformName(device.target);
}

async function repairMacOsRunnerProductsIfNeeded(
  device: DeviceInfo,
  xctestrunPath: string,
): Promise<void> {
  if (device.platform !== 'macos') {
    return;
  }
  const resolvedProductPaths = resolveXctestrunProductPaths(xctestrunPath);
  if (!resolvedProductPaths) {
    throw new AppError('COMMAND_FAILED', 'Missing macOS runner product', {
      xctestrunPath,
    });
  }
  const productPaths = Array.from(
    new Set([...resolvedProductPaths.rootProductPaths, ...resolvedProductPaths.hostProductPaths]),
  ).sort((left, right) => right.length - left.length);
  for (const productPath of productPaths) {
    if (!fs.existsSync(productPath)) {
      throw new AppError('COMMAND_FAILED', 'Missing macOS runner product', {
        productPath,
        xctestrunPath,
      });
    }
  }

  for (const productPath of productPaths) {
    await runCmd('codesign', ['--remove-signature', productPath], { allowFailure: true });
    await runCmd('codesign', ['--force', '--sign', '-', productPath]);
  }
}

function resolveMacRunnerArch(): 'arm64' | 'x86_64' {
  return process.arch === 'arm64' ? 'arm64' : 'x86_64';
}

export function resolveRunnerMaxConcurrentDestinationsFlag(device: DeviceInfo): string {
  if (device.platform === 'macos') {
    return '-maximum-concurrent-test-device-destinations';
  }
  return device.kind === 'device'
    ? '-maximum-concurrent-test-device-destinations'
    : '-maximum-concurrent-test-simulator-destinations';
}

export function resolveRunnerSigningBuildSettings(
  env: NodeJS.ProcessEnv = process.env,
  forDevice = false,
  platform: DeviceInfo['platform'] = 'ios',
): string[] {
  if (platform === 'macos') {
    return [
      'CODE_SIGNING_ALLOWED=NO',
      'CODE_SIGNING_REQUIRED=NO',
      'CODE_SIGN_IDENTITY=',
      'DEVELOPMENT_TEAM=',
    ];
  }
  if (!forDevice) {
    return [];
  }
  const teamId = env.AGENT_DEVICE_IOS_TEAM_ID?.trim() || '';
  const configuredIdentity = env.AGENT_DEVICE_IOS_SIGNING_IDENTITY?.trim() || '';
  const profile = env.AGENT_DEVICE_IOS_PROVISIONING_PROFILE?.trim() || '';
  const args = ['CODE_SIGN_STYLE=Automatic'];
  if (teamId) {
    args.push(`DEVELOPMENT_TEAM=${teamId}`);
  }
  if (configuredIdentity) {
    args.push(`CODE_SIGN_IDENTITY=${configuredIdentity}`);
  }
  if (profile) args.push(`PROVISIONING_PROFILE_SPECIFIER=${profile}`);
  return args;
}

export function resolveRunnerBundleBuildSettings(env: NodeJS.ProcessEnv = process.env): string[] {
  const appBundleId = resolveRunnerAppBundleId(env);
  const testBundleId = resolveRunnerTestBundleId(env);
  return [
    `AGENT_DEVICE_IOS_RUNNER_APP_BUNDLE_ID=${appBundleId}`,
    `AGENT_DEVICE_IOS_RUNNER_TEST_BUNDLE_ID=${testBundleId}`,
  ];
}

export function resolveRunnerPerformanceBuildSettings(): string[] {
  return ['COMPILER_INDEX_STORE_ENABLE=NO', 'ENABLE_CODE_COVERAGE=NO'];
}

function shouldCleanDerived(): boolean {
  return isEnvTruthy(process.env.AGENT_DEVICE_IOS_CLEAN_DERIVED);
}

export function assertSafeDerivedCleanup(
  derivedPath: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const override = env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH?.trim();
  if (!override) {
    return;
  }
  if (isCleanupOverrideAllowed(env)) {
    return;
  }
  throw new AppError(
    'COMMAND_FAILED',
    'Refusing to clean AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH automatically',
    {
      derivedPath,
      hint: 'Unset AGENT_DEVICE_IOS_CLEAN_DERIVED, or set AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN=1 if you trust this path.',
    },
  );
}

function isCleanupOverrideAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return isEnvTruthy(env.AGENT_DEVICE_IOS_ALLOW_OVERRIDE_DERIVED_CLEAN);
}
