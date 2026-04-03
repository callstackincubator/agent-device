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
import { resolveIosSimulatorDeviceSetPath } from '../../utils/device-isolation.ts';
import { isProcessAlive, readProcessStartTime } from '../../utils/process-identity.ts';
import { isEnvTruthy } from '../../utils/retry.ts';
import { resolveApplePlatformName, type DeviceInfo } from '../../utils/device.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { resolveSigningFailureHint } from './runner-contract.ts';
import { logChunk } from './runner-transport.ts';
import {
  repairMacOsRunnerProductsIfNeeded,
  isExpectedRunnerRepairFailure,
} from './runner-macos-products.ts';

const DEFAULT_IOS_RUNNER_APP_BUNDLE_ID = 'com.callstack.agentdevice.runner';
const XCTEST_DEVICE_SET_BASE_NAME = 'XCTestDevices';
const XCTEST_DEVICE_SET_BACKUP_SUFFIX = '.agent-device-backup';
const XCTEST_DEVICE_SET_LEGACY_BACKUP_PREFIX = '.agent-device-xctestdevices-backup-';

const RUNNER_DERIVED_ROOT = path.join(os.homedir(), '.agent-device', 'ios-runner');
const XCTEST_DEVICE_SET_LOCK_TIMEOUT_MS = 30_000;
const XCTEST_DEVICE_SET_LOCK_POLL_MS = 100;
const XCTEST_DEVICE_SET_LOCK_OWNER_GRACE_MS = 5_000;

const runnerXctestrunBuildLocks = new Map<string, Promise<unknown>>();
export const runnerPrepProcesses = new Set<ExecBackgroundResult['child']>();

type XcodebuildSimulatorSetRedirectHandle = {
  release: () => Promise<void>;
};

type XcodebuildSimulatorSetRedirectOptions = {
  xctestDeviceSetPath?: string;
  backupPath?: string;
  lockDirPath?: string;
  ownerPid?: number;
  ownerStartTime?: string | null;
  nowMs?: number;
};

type XcodebuildSimulatorSetLockOwner = {
  pid: number;
  startTime: string | null;
  acquiredAtMs: number;
};

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

export function resolveXcodebuildSimulatorDeviceSetPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, 'Library', 'Developer', 'XCTestDevices');
}

function resolveXcodebuildSimulatorDeviceSetLockPath(homeDir: string = os.homedir()): string {
  return path.join(homeDir, '.agent-device', 'xctest-device-set.lock');
}

function resolveXcodebuildSimulatorDeviceSetBackupPath(
  xctestDeviceSetPath: string = resolveXcodebuildSimulatorDeviceSetPath(),
): string {
  return `${xctestDeviceSetPath}${XCTEST_DEVICE_SET_BACKUP_SUFFIX}`;
}

export async function acquireXcodebuildSimulatorSetRedirect(
  device: DeviceInfo,
  options: XcodebuildSimulatorSetRedirectOptions = {},
): Promise<XcodebuildSimulatorSetRedirectHandle | null> {
  if (device.platform !== 'ios' || device.kind !== 'simulator') {
    return null;
  }
  const simulatorSetPath = resolveIosSimulatorDeviceSetPath(device.simulatorSetPath);
  if (!simulatorSetPath) {
    return null;
  }
  const requestedSetPath = path.resolve(simulatorSetPath);
  const xctestDeviceSetPath = path.resolve(
    options.xctestDeviceSetPath ?? resolveXcodebuildSimulatorDeviceSetPath(),
  );
  const backupPath = path.resolve(
    options.backupPath ?? resolveXcodebuildSimulatorDeviceSetBackupPath(xctestDeviceSetPath),
  );
  const lockDirPath = path.resolve(
    options.lockDirPath ?? resolveXcodebuildSimulatorDeviceSetLockPath(),
  );
  const ownerStartTime = options.ownerStartTime ?? readProcessStartTime(process.pid);
  const releaseLock = await acquireXcodebuildSimulatorSetLock({
    lockDirPath,
    owner: {
      pid: options.ownerPid ?? process.pid,
      startTime: ownerStartTime,
      acquiredAtMs: options.nowMs ?? Date.now(),
    },
  });

  try {
    reconcileXcodebuildSimulatorSetRedirect({
      xctestDeviceSetPath,
      backupPath,
    });
    if (sameResolvedPath(requestedSetPath, xctestDeviceSetPath)) {
      await releaseLock();
      return null;
    }

    fs.mkdirSync(requestedSetPath, { recursive: true });
    if (fs.existsSync(xctestDeviceSetPath)) {
      fs.renameSync(xctestDeviceSetPath, backupPath);
    }
    installXcodebuildSimulatorSetSymlink({
      requestedSetPath,
      xctestDeviceSetPath,
    });
  } catch (error) {
    reconcileXcodebuildSimulatorSetRedirect({
      xctestDeviceSetPath,
      backupPath,
    });
    await releaseLock();
    throw new AppError('COMMAND_FAILED', 'Failed to redirect XCTest device set path', {
      requestedSetPath,
      xctestDeviceSetPath,
      backupPath,
      error: String(error),
    });
  }

  let released = false;
  return {
    release: async () => {
      if (released) {
        return;
      }
      released = true;
      try {
        reconcileXcodebuildSimulatorSetRedirect({
          xctestDeviceSetPath,
          backupPath,
        });
      } finally {
        await releaseLock();
      }
    },
  };
}

function reconcileXcodebuildSimulatorSetRedirect(paths: {
  xctestDeviceSetPath: string;
  backupPath: string;
}): void {
  const { xctestDeviceSetPath, backupPath } = paths;
  const existingBackups = [backupPath, ...findLegacyXcodebuildSimulatorSetBackups(backupPath)];
  const activeBackupPath = existingBackups.find((candidate) => fs.existsSync(candidate));
  const xctestExists = fs.existsSync(xctestDeviceSetPath);
  const xctestIsSymlink = xctestExists && fs.lstatSync(xctestDeviceSetPath).isSymbolicLink();

  if (activeBackupPath) {
    if (xctestIsSymlink) {
      unlinkIfSymlink(xctestDeviceSetPath);
    }
    if (!fs.existsSync(xctestDeviceSetPath)) {
      fs.mkdirSync(path.dirname(xctestDeviceSetPath), { recursive: true });
      fs.renameSync(activeBackupPath, xctestDeviceSetPath);
    } else if (activeBackupPath !== backupPath) {
      fs.rmSync(activeBackupPath, { recursive: true, force: true });
    } else {
      fs.rmSync(backupPath, { recursive: true, force: true });
    }
    for (const candidate of existingBackups) {
      if (candidate !== activeBackupPath && fs.existsSync(candidate)) {
        fs.rmSync(candidate, { recursive: true, force: true });
      }
    }
    return;
  }

  if (xctestIsSymlink) {
    emitDiagnostic({
      level: 'warn',
      phase: 'ios_runner_xctest_device_set_orphaned_symlink',
      data: {
        xctestDeviceSetPath,
      },
    });
    unlinkIfSymlink(xctestDeviceSetPath);
  }
}

function findLegacyXcodebuildSimulatorSetBackups(backupPath: string): string[] {
  const parentDir = path.dirname(backupPath);
  const backupBaseName = path.basename(backupPath).replace(XCTEST_DEVICE_SET_BACKUP_SUFFIX, '');
  const legacyPrefix =
    backupBaseName === XCTEST_DEVICE_SET_BASE_NAME
      ? XCTEST_DEVICE_SET_LEGACY_BACKUP_PREFIX
      : `${backupBaseName}${XCTEST_DEVICE_SET_LEGACY_BACKUP_PREFIX}`;
  try {
    return fs
      .readdirSync(parentDir)
      .filter((entry) => entry.startsWith(legacyPrefix))
      .sort()
      .map((entry) => path.join(parentDir, entry));
  } catch {
    return [];
  }
}

function installXcodebuildSimulatorSetSymlink(paths: {
  requestedSetPath: string;
  xctestDeviceSetPath: string;
}): void {
  const { requestedSetPath, xctestDeviceSetPath } = paths;
  const parentDir = path.dirname(xctestDeviceSetPath);
  const tmpSymlinkPath = path.join(
    parentDir,
    `${XCTEST_DEVICE_SET_BASE_NAME}.agent-device-link-${process.pid}-${Date.now()}`,
  );
  fs.mkdirSync(parentDir, { recursive: true });
  try {
    fs.symlinkSync(requestedSetPath, tmpSymlinkPath, 'dir');
    fs.renameSync(tmpSymlinkPath, xctestDeviceSetPath);
  } catch (error) {
    if (fs.existsSync(tmpSymlinkPath)) {
      unlinkIfSymlink(tmpSymlinkPath);
    }
    throw error;
  }
}

function unlinkIfSymlink(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  if (!fs.lstatSync(targetPath).isSymbolicLink()) {
    return;
  }
  fs.unlinkSync(targetPath);
}

function sameResolvedPath(left: string, right: string): boolean {
  const candidates = (value: string): string[] => {
    const resolved = path.resolve(value);
    try {
      return [resolved, fs.realpathSync.native(resolved)];
    } catch {
      return [resolved];
    }
  };
  const rightCandidates = new Set(candidates(right));
  return candidates(left).some((candidate) => rightCandidates.has(candidate));
}

async function acquireXcodebuildSimulatorSetLock(params: {
  lockDirPath: string;
  owner: XcodebuildSimulatorSetLockOwner;
}): Promise<() => Promise<void>> {
  const { lockDirPath, owner } = params;
  const ownerFilePath = path.join(lockDirPath, 'owner.json');
  const deadline = Date.now() + XCTEST_DEVICE_SET_LOCK_TIMEOUT_MS;

  fs.mkdirSync(path.dirname(lockDirPath), { recursive: true });

  while (Date.now() < deadline) {
    try {
      fs.mkdirSync(lockDirPath);
      writeXcodebuildSimulatorSetLockOwner(ownerFilePath, owner);
      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        fs.rmSync(lockDirPath, { recursive: true, force: true });
      };
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'EEXIST') {
        throw err;
      }
      if (clearStaleXcodebuildSimulatorSetLock(lockDirPath, ownerFilePath)) {
        continue;
      }
      await new Promise((resolve) => setTimeout(resolve, XCTEST_DEVICE_SET_LOCK_POLL_MS));
    }
  }

  throw new AppError('COMMAND_FAILED', 'Timed out waiting for XCTest device set lock', {
    lockDirPath,
  });
}

function writeXcodebuildSimulatorSetLockOwner(
  ownerFilePath: string,
  owner: XcodebuildSimulatorSetLockOwner,
): void {
  const tmpOwnerFilePath = `${ownerFilePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpOwnerFilePath, JSON.stringify(owner), 'utf8');
  fs.renameSync(tmpOwnerFilePath, ownerFilePath);
}

function clearStaleXcodebuildSimulatorSetLock(lockDirPath: string, ownerFilePath: string): boolean {
  let ownerStats: fs.Stats | null = null;
  try {
    ownerStats = fs.statSync(lockDirPath);
  } catch {
    return true;
  }

  const owner = readXcodebuildSimulatorSetLockOwner(ownerFilePath);
  if (owner && isLiveXcodebuildSimulatorSetLockOwner(owner)) {
    return false;
  }
  if (owner && !isLiveXcodebuildSimulatorSetLockOwner(owner)) {
    fs.rmSync(lockDirPath, { recursive: true, force: true });
    return true;
  }
  if (Date.now() - ownerStats.mtimeMs < XCTEST_DEVICE_SET_LOCK_OWNER_GRACE_MS) {
    return false;
  }
  fs.rmSync(lockDirPath, { recursive: true, force: true });
  return true;
}

function readXcodebuildSimulatorSetLockOwner(
  ownerFilePath: string,
): XcodebuildSimulatorSetLockOwner | null {
  try {
    return JSON.parse(fs.readFileSync(ownerFilePath, 'utf8')) as XcodebuildSimulatorSetLockOwner;
  } catch {
    return null;
  }
}

function isLiveXcodebuildSimulatorSetLockOwner(owner: XcodebuildSimulatorSetLockOwner): boolean {
  if (!Number.isInteger(owner.pid) || owner.pid <= 0) {
    return false;
  }
  if (!isProcessAlive(owner.pid)) {
    return false;
  }
  if (owner.startTime) {
    return readProcessStartTime(owner.pid) === owner.startTime;
  }
  return true;
}

export async function ensureXctestrun(
  device: DeviceInfo,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<string> {
  const derived = resolveRunnerDerivedPath(device);
  const projectRoot = findProjectRoot();
  return await withKeyedLock(runnerXctestrunBuildLocks, derived, async () => {
    if (shouldCleanDerived()) {
      emitRunnerXctestrunDecision('clean', 'forced_clean', { derived });
      assertSafeDerivedCleanup(derived);
      cleanRunnerDerivedArtifacts(derived);
    }
    const existing = evaluateExistingXctestrun({
      derived,
      projectRoot,
      findXctestrun: (root) => findXctestrun(root, device),
      xctestrunReferencesProjectRoot,
      resolveExistingXctestrunProductPaths,
    });
    if (existing.reason !== 'reuse_ready') {
      emitRunnerXctestrunDecision('rebuild', existing.reason, {
        derived,
        xctestrunPath: existing.xctestrunPath,
      });
    }
    if (existing.reason === 'reuse_ready') {
      try {
        await repairMacOsRunnerProductsIfNeeded(
          device,
          existing.productPaths,
          existing.xctestrunPath,
        );
        emitRunnerXctestrunDecision('reuse', 'reuse_ready', {
          derived,
          xctestrunPath: existing.xctestrunPath,
        });
        return existing.xctestrunPath;
      } catch (error) {
        if (!isExpectedRunnerRepairFailure(error)) {
          throw error;
        }
        emitRunnerXctestrunDecision('rebuild', 'repair_failed', {
          derived,
          xctestrunPath: existing.xctestrunPath,
        });
        // Fall through and rebuild from a clean derived state.
      }
    }
    if (existing.xctestrunPath) {
      assertSafeDerivedCleanup(derived);
      cleanRunnerDerivedArtifacts(derived);
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

    await buildRunnerXctestrun(device, projectPath, derived, options);

    const built = findXctestrun(derived, device);
    if (!built) {
      throw new AppError('COMMAND_FAILED', 'Failed to locate .xctestrun after build');
    }
    const builtProductPaths = resolveExistingXctestrunProductPaths(built);
    if (!builtProductPaths) {
      throw new AppError('COMMAND_FAILED', 'Runner build is missing expected products', {
        xctestrunPath: built,
      });
    }
    await repairMacOsRunnerProductsIfNeeded(device, builtProductPaths, built);
    emitRunnerXctestrunDecision('build', 'built_new', {
      derived,
      xctestrunPath: built,
    });
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

type XctestrunCandidate = {
  path: string;
  mtimeMs: number;
};

export function findXctestrun(root: string, device?: DeviceInfo): string | null {
  if (!fs.existsSync(root)) return null;
  const candidates: XctestrunCandidate[] = [];
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
  candidates.sort((a, b) => {
    if (device) {
      const scoreDiff =
        scoreXctestrunCandidate(b.path, device) - scoreXctestrunCandidate(a.path, device);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }
    }
    return b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path);
  });
  return candidates[0]?.path ?? null;
}

export function scoreXctestrunCandidate(candidatePath: string, device: DeviceInfo): number {
  let score = 0;
  const normalizedPath = candidatePath.toLowerCase();
  const fileName = path.basename(normalizedPath);

  if (fileName.startsWith('agentdevicerunner.env.')) {
    score -= 1_000;
  }

  if (normalizedPath.includes(`${path.sep}macos${path.sep}`)) {
    score -= 5_000;
  }

  const platformHints = resolveRunnerXctestrunHints(device);
  if (platformHints.preferred.length > 0) {
    if (platformHints.preferred.some((hint) => normalizedPath.includes(hint))) {
      score += 2_000;
    } else {
      score -= 500;
    }
  }

  if (platformHints.disallowed.some((hint) => normalizedPath.includes(hint))) {
    score -= 2_500;
  }

  return score;
}

function resolveRunnerXctestrunHints(device: DeviceInfo): {
  preferred: string[];
  disallowed: string[];
} {
  if (device.platform === 'macos') {
    return {
      preferred: ['macos'],
      disallowed: ['iphoneos', 'iphonesimulator', 'appletvos', 'appletvsimulator'],
    };
  }

  if (device.target === 'tv') {
    if (device.kind === 'simulator') {
      return {
        preferred: ['appletvsimulator'],
        disallowed: ['appletvos', 'iphoneos', 'iphonesimulator', 'macos'],
      };
    }
    return {
      preferred: ['appletvos'],
      disallowed: ['appletvsimulator', 'iphoneos', 'iphonesimulator', 'macos'],
    };
  }

  if (device.kind === 'simulator') {
    return {
      preferred: ['iphonesimulator'],
      disallowed: ['iphoneos', 'appletvos', 'appletvsimulator', 'macos'],
    };
  }

  return {
    preferred: ['iphoneos'],
    disallowed: ['iphonesimulator', 'appletvos', 'appletvsimulator', 'macos'],
  };
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
  const simulatorSetRedirect = await acquireXcodebuildSimulatorSetRedirect(device);
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
  } finally {
    await simulatorSetRedirect?.release();
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

type ExistingXctestrunState =
  | {
      reason: 'missing_xctestrun';
      xctestrunPath: null;
    }
  | {
      reason: 'project_root_mismatch' | 'missing_products' | 'reuse_ready';
      xctestrunPath: string;
      productPaths: string[];
    };

function evaluateExistingXctestrun(options: {
  derived: string;
  projectRoot: string;
  findXctestrun: (root: string) => string | null;
  xctestrunReferencesProjectRoot: (xctestrunPath: string, projectRoot: string) => boolean;
  resolveExistingXctestrunProductPaths: (xctestrunPath: string) => string[] | null;
}): ExistingXctestrunState {
  const xctestrunPath = options.findXctestrun(options.derived);
  if (!xctestrunPath) {
    return { reason: 'missing_xctestrun', xctestrunPath: null };
  }
  const productPaths = options.resolveExistingXctestrunProductPaths(xctestrunPath);
  if (!productPaths) {
    return { reason: 'missing_products', xctestrunPath, productPaths: [] };
  }
  if (!options.xctestrunReferencesProjectRoot(xctestrunPath, options.projectRoot)) {
    return { reason: 'project_root_mismatch', xctestrunPath, productPaths };
  }
  return { reason: 'reuse_ready', xctestrunPath, productPaths };
}

function emitRunnerXctestrunDecision(
  action: 'clean' | 'reuse' | 'rebuild' | 'build',
  reason:
    | 'forced_clean'
    | 'missing_xctestrun'
    | 'project_root_mismatch'
    | 'missing_products'
    | 'repair_failed'
    | 'reuse_ready'
    | 'built_new',
  data: Record<string, unknown>,
): void {
  emitDiagnostic({
    level: action === 'rebuild' ? 'warn' : 'info',
    phase: 'runner_xctestrun_cache',
    data: {
      action,
      reason,
      ...data,
    },
  });
}

// --- xctestrun product resolution (merged from runner-xctestrun-products.ts) ---

export function xctestrunReferencesExistingProducts(xctestrunPath: string): boolean {
  try {
    return resolveExistingXctestrunProductPaths(xctestrunPath) !== null;
  } catch {
    return false;
  }
}

export function resolveExistingXctestrunProductPaths(xctestrunPath: string): string[] | null {
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
    const resolvedHostRoot = Array.from(hostRoots).find((hostRoot) =>
      fs.existsSync(path.join(hostRoot, relativePath)),
    );
    if (!resolvedHostRoot) {
      return null;
    }
    resolvedPaths.add(path.join(resolvedHostRoot, relativePath));
  }

  return Array.from(resolvedPaths);
}

function resolveXctestrunProductReferences(xctestrunPath: string): string[] | null {
  const parsed = readXctestrunJson(xctestrunPath);
  if (parsed) {
    return resolveXctestrunProductReferencesFromJson(parsed);
  }
  if (process.platform === 'darwin') {
    // On real macOS runner builds, plutil should always be available. If it cannot parse the
    // file here, treat the xctestrun as unusable instead of masking a corrupt plist with a
    // best-effort regex fallback.
    return null;
  }
  try {
    // Keep a simple XML fallback only for non-macOS test environments where plutil is absent.
    return resolveXctestrunProductReferencesFromXml(fs.readFileSync(xctestrunPath, 'utf8'));
  } catch {
    return null;
  }
}

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

function extractPlistArrayStringValues(contents: string, key: string): string[] {
  // Best-effort XML extraction only. Prefer the plutil JSON path on macOS.
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
