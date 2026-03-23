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
  resolveExistingXctestrunProductPaths: (xctestrunPath: string) => string[] | null;
  repairRunnerProductsIfNeeded: (
    device: DeviceInfo,
    productPaths: string[],
    xctestrunPath: string,
  ) => Promise<void>;
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
  resolveExistingXctestrunProductPaths,
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
    const existingProductPaths = existing
      ? deps.resolveExistingXctestrunProductPaths(existing)
      : null;
    const canReuseExisting =
      existing &&
      deps.xctestrunReferencesProjectRoot(existing, projectRoot) &&
      existingProductPaths !== null;
    if (canReuseExisting) {
      try {
        await deps.repairRunnerProductsIfNeeded(device, existingProductPaths, existing);
        return existing;
      } catch (error) {
        if (!isExpectedRunnerRepairFailure(error)) {
          throw error;
        }
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
    const builtProductPaths = deps.resolveExistingXctestrunProductPaths(built);
    if (!builtProductPaths) {
      throw new AppError('COMMAND_FAILED', 'Runner build is missing expected products', {
        xctestrunPath: built,
      });
    }
    await deps.repairRunnerProductsIfNeeded(device, builtProductPaths, built);
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
    return resolveExistingXctestrunProductPaths(xctestrunPath) !== null;
  } catch {
    return false;
  }
}

const RUNNER_PRODUCT_REPAIR_FAILURE_REASONS = new Set([
  'RUNNER_PRODUCT_MISSING',
  'RUNNER_PRODUCT_REPAIR_FAILED',
]);

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

function collectXctestrunProductReferenceValuesFromTarget(
  target: Record<string, unknown>,
): string[] {
  const productPathKeys = new Set([
    'ProductPaths',
    'DependentProductPaths',
    'TestHostPath',
    'TestBundlePath',
    'UITargetAppPath',
  ]);
  const values = new Set<string>();
  for (const [key, value] of Object.entries(target)) {
    if (!productPathKeys.has(key)) {
      continue;
    }
    if (typeof value === 'string') {
      values.add(value);
      continue;
    }
    if (!Array.isArray(value)) {
      continue;
    }
    for (const item of value) {
      if (typeof item === 'string') {
        values.add(item);
      }
    }
  }
  return Array.from(values);
}

function resolveXctestrunProductReferencesFromJson(parsed: Record<string, unknown>): string[] {
  const values = new Set<string>();
  const addTargetValues = (target: unknown) => {
    if (!target || typeof target !== 'object') {
      return;
    }
    for (const value of collectXctestrunProductReferenceValuesFromTarget(
      target as Record<string, unknown>,
    )) {
      values.add(value);
    }
  };

  addTargetValues(parsed);

  const testConfigurations = parsed.TestConfigurations;
  if (Array.isArray(testConfigurations)) {
    for (const config of testConfigurations) {
      if (!config || typeof config !== 'object') {
        continue;
      }
      const testTargets = (config as Record<string, unknown>).TestTargets;
      if (!Array.isArray(testTargets)) {
        continue;
      }
      for (const target of testTargets) {
        addTargetValues(target);
      }
    }
  }

  for (const value of Object.values(parsed)) {
    if (!value || typeof value !== 'object' || !('TestBundlePath' in value)) {
      continue;
    }
    addTargetValues(value);
  }

  return Array.from(values);
}

function resolveXctestrunProductReferencesFromXml(contents: string): string[] {
  const arrayPathKeys = ['ProductPaths', 'DependentProductPaths'];
  const stringPathKeys = ['TestHostPath', 'TestBundlePath', 'UITargetAppPath'];
  return Array.from(
    new Set([
      ...arrayPathKeys.flatMap((key) => extractPlistArrayStringValues(contents, key)),
      ...stringPathKeys.flatMap((key) => extractPlistStringValues(contents, key)),
    ]),
  );
}

function resolveExistingXctestrunProductPaths(xctestrunPath: string): string[] | null {
  const values = resolveXctestrunProductReferences(xctestrunPath);
  if (!values || values.length === 0) {
    return null;
  }
  const testRoot = path.dirname(xctestrunPath);
  const resolvedPaths = new Set<string>();
  const hostRoots = new Set<string>();
  const hostRelativePaths: string[] = [];

  for (const value of values) {
    if (value.startsWith('__TESTROOT__/')) {
      const relativePath = value.slice('__TESTROOT__/'.length);
      const resolvedPath = path.join(testRoot, relativePath);
      if (!fs.existsSync(resolvedPath)) {
        return null;
      }
      resolvedPaths.add(resolvedPath);
      const appBundleRoot = extractAppBundleRoot(relativePath);
      if (appBundleRoot) {
        hostRoots.add(path.join(testRoot, appBundleRoot));
      }
      continue;
    }
    if (value.startsWith('__TESTHOST__/')) {
      hostRelativePaths.push(value.slice('__TESTHOST__/'.length));
    }
  }

  for (const relativePath of hostRelativePaths) {
    const resolvedHostPath = Array.from(hostRoots).find((hostRoot) =>
      fs.existsSync(path.join(hostRoot, relativePath)),
    );
    if (!resolvedHostPath) {
      return null;
    }
    resolvedPaths.add(path.join(resolvedHostPath, relativePath));
  }

  return Array.from(resolvedPaths);
}

function resolveXctestrunProductReferences(xctestrunPath: string): string[] | null {
  const parsed = readXctestrunJson(xctestrunPath);
  if (parsed) {
    return resolveXctestrunProductReferencesFromJson(parsed);
  }
  if (process.platform === 'darwin') {
    return null;
  }
  try {
    // Keep a simple XML fallback only for non-macOS test environments where plutil is absent.
    return resolveXctestrunProductReferencesFromXml(fs.readFileSync(xctestrunPath, 'utf8'));
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
  // Best-effort XML extraction only. Prefer readXctestrunJson() for structured parsing.
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
  const match = /\.app(?:\/|$)/.exec(relativePath);
  if (!match || match.index === undefined) {
    return null;
  }
  return relativePath.slice(0, match.index + '.app'.length);
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
  productPaths: string[],
  xctestrunPath: string,
): Promise<void> {
  if (device.platform !== 'macos') {
    return;
  }
  if (productPaths.length === 0) {
    throw new AppError('COMMAND_FAILED', 'Missing macOS runner product', {
      reason: 'RUNNER_PRODUCT_MISSING',
      xctestrunPath,
    });
  }
  const sortedProductPaths = Array.from(new Set(productPaths)).sort(
    (left, right) => right.length - left.length,
  );
  for (const productPath of sortedProductPaths) {
    if (!fs.existsSync(productPath)) {
      throw new AppError('COMMAND_FAILED', 'Missing macOS runner product', {
        reason: 'RUNNER_PRODUCT_MISSING',
        productPath,
        xctestrunPath,
      });
    }
  }

  for (const productPath of sortedProductPaths) {
    if (hasValidCodeSignature(productPath)) {
      continue;
    }
    await runCmd('codesign', ['--remove-signature', productPath], { allowFailure: true });
    try {
      await runCmd('codesign', ['--force', '--sign', '-', productPath]);
    } catch (error) {
      const appError =
        error instanceof AppError ? error : new AppError('COMMAND_FAILED', String(error));
      throw new AppError('COMMAND_FAILED', 'Failed to repair macOS runner product signature', {
        reason: 'RUNNER_PRODUCT_REPAIR_FAILED',
        productPath,
        xctestrunPath,
        error: appError.message,
        details: appError.details,
      });
    }
  }
}

function hasValidCodeSignature(productPath: string): boolean {
  const result = runCmdSync('codesign', ['--verify', '--deep', '--strict', productPath], {
    allowFailure: true,
  });
  return result.exitCode === 0;
}

function isExpectedRunnerRepairFailure(error: unknown): boolean {
  if (!(error instanceof AppError)) {
    return false;
  }
  const reason =
    error.details && typeof error.details === 'object'
      ? (error.details as Record<string, unknown>).reason
      : undefined;
  return typeof reason === 'string' && RUNNER_PRODUCT_REPAIR_FAILURE_REASONS.has(reason);
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
