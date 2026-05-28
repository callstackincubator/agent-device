import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../utils/errors.ts';
import { sleep } from '../../utils/timeouts.ts';
import { runCmdStreaming, type ExecBackgroundResult } from '../../utils/exec.ts';
import { resolveIosSimulatorDeviceSetPath } from '../../utils/device-isolation.ts';
import { isProcessAlive, readProcessStartTime } from '../../utils/process-identity.ts';
import { isEnvTruthy } from '../../utils/retry.ts';
import { resolveApplePlatformName, type DeviceInfo } from '../../utils/device.ts';
import { withKeyedLock } from '../../utils/keyed-lock.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import { findProjectRoot, readVersion } from '../../utils/version.ts';
import { resolveRunnerBuildFailureHint } from './runner-contract.ts';
import { logChunk } from './runner-transport.ts';
import { runAppleToolCommand } from './tool-provider.ts';
import {
  repairMacOsRunnerProductsIfNeeded,
  isExpectedRunnerRepairFailure,
} from './runner-macos-products.ts';
import { resolveExistingXctestrunProductPaths } from './runner-xctestrun-products.ts';
import { applyXctestRunnerAppIcon } from './runner-icon.ts';

const DEFAULT_IOS_RUNNER_APP_BUNDLE_ID = 'com.callstack.agentdevice.runner';
const XCTEST_DEVICE_SET_BASE_NAME = 'XCTestDevices';
const XCTEST_DEVICE_SET_BACKUP_SUFFIX = '.agent-device-backup';
const XCTEST_DEVICE_SET_LEGACY_BACKUP_PREFIX = '.agent-device-xctestdevices-backup-';

const RUNNER_DERIVED_ROOT = path.join(os.homedir(), '.agent-device', 'ios-runner');
const RUNNER_CACHE_METADATA_FILE = '.agent-device-runner-cache.json';
const RUNNER_CACHE_SCHEMA_VERSION = 1;
const XCTEST_DEVICE_SET_LOCK_TIMEOUT_MS = 30_000;
const XCTEST_DEVICE_SET_LOCK_POLL_MS = 100;
const XCTEST_DEVICE_SET_LOCK_OWNER_GRACE_MS = 5_000;
const RUNNER_XCTESTRUN_CAPTURE_OPTIONS = {
  PreferredScreenCaptureFormat: 'screenshots',
  SystemAttachmentLifetime: 'keepNever',
  UserAttachmentLifetime: 'keepNever',
} as const;

const runnerXctestrunBuildLocks = new Map<string, Promise<unknown>>();
export const runnerPrepProcesses = new Set<ExecBackgroundResult['child']>();

type EnvMap = Record<string, string>;
type XctestrunTarget = {
  TestBundlePath?: unknown;
  EnvironmentVariables?: EnvMap;
  UITestEnvironmentVariables?: EnvMap;
  UITargetAppEnvironmentVariables?: EnvMap;
  TestingEnvironmentVariables?: EnvMap;
  [key: string]: unknown;
};
type XctestrunConfig = {
  TestTargets?: unknown;
  [key: string]: unknown;
};
type XctestrunPlist = {
  TestConfigurations?: unknown;
  [key: string]: unknown;
};
type XctestrunTargetVisitOptions = {
  requireTestBundlePath?: boolean;
};

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

export type RunnerXctestrunCacheMetadata = {
  schemaVersion: number;
  packageVersion: string;
  runnerSourceFingerprint: string;
  platformName: string;
  deviceKind: DeviceInfo['kind'];
  target: DeviceInfo['target'] | 'phone';
  buildDestinationFamily: string;
  runnerBundleBuildSettings: string[];
  runnerSigningBuildSettings: string[];
  runnerPerformanceBuildSettings: string[];
  artifacts?: RunnerXctestrunCacheArtifacts;
};

type RunnerXctestrunCacheArtifacts = {
  xctestrunPath: string;
  xctestrunMtimeMs: number;
  productPaths: RunnerXctestrunCacheProductArtifact[];
};

type RunnerXctestrunCacheProductArtifact = {
  path: string;
  mtimeMs: number;
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

// fallow-ignore-next-line complexity
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
    } else if (!xctestIsSymlink) {
      emitDiagnostic({
        level: 'warn',
        phase: 'ios_runner_xctest_device_set_restore_collision',
        data: {
          xctestDeviceSetPath,
          activeBackupPath,
        },
      });
      return;
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
  if (path.resolve(left) === path.resolve(right)) {
    return true;
  }
  try {
    return fs.realpathSync.native(left) === fs.realpathSync.native(right);
  } catch {
    return false;
  }
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
      await sleep(XCTEST_DEVICE_SET_LOCK_POLL_MS);
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
  if (owner) {
    if (isLiveXcodebuildSimulatorSetLockOwner(owner)) {
      return false;
    }
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
  // fallow-ignore-next-line complexity
  return await withKeyedLock(runnerXctestrunBuildLocks, derived, async () => {
    const expectedCacheMetadata = resolveExpectedRunnerCacheMetadata(device, projectRoot);
    if (shouldCleanDerived()) {
      emitRunnerXctestrunDecision('clean', 'forced_clean', { derived });
      assertSafeDerivedCleanup(derived);
      cleanRunnerDerivedArtifacts(derived);
    }
    const existing = await evaluateExistingXctestrun({
      derived,
      projectRoot,
      expectedCacheMetadata,
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
        writeRunnerCacheMetadata(
          derived,
          withRunnerCacheArtifacts(
            expectedCacheMetadata,
            existing.xctestrunPath,
            existing.productPaths,
          ),
        );
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
    const builtProductPaths = await resolveExistingXctestrunProductPaths(built);
    if (!builtProductPaths) {
      throw new AppError('COMMAND_FAILED', 'Runner build is missing expected products', {
        xctestrunPath: built,
      });
    }
    await repairMacOsRunnerProductsIfNeeded(device, builtProductPaths, built);
    // Release/dev script builds patch the synthesized XCTest runner app in scripts/.
    // This covers direct local xcodebuilds triggered by ensureXctestrun on cache miss.
    await applyXctestRunnerAppIcon(builtProductPaths);
    writeRunnerCacheMetadata(
      derived,
      withRunnerCacheArtifacts(expectedCacheMetadata, built, builtProductPaths),
    );
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
  } catch {}
}

const RUNNER_ROOT_TRANSIENT_ENTRY_NAMES = new Set([
  RUNNER_CACHE_METADATA_FILE,
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

export function resolveRunnerCacheMetadataPath(derived: string): string {
  return path.join(derived, RUNNER_CACHE_METADATA_FILE);
}

export function resolveExpectedRunnerCacheMetadata(
  device: DeviceInfo,
  projectRoot: string = findProjectRoot(),
): RunnerXctestrunCacheMetadata {
  return {
    schemaVersion: RUNNER_CACHE_SCHEMA_VERSION,
    packageVersion: readVersion(),
    runnerSourceFingerprint: computeRunnerSourceFingerprint(projectRoot),
    platformName: resolveRunnerPlatformName(device),
    deviceKind: device.kind,
    target: device.target ?? 'phone',
    buildDestinationFamily: resolveRunnerBuildDestinationFamily(device),
    runnerBundleBuildSettings: resolveRunnerBundleBuildSettings(process.env),
    runnerSigningBuildSettings: resolveRunnerSigningBuildSettings(
      process.env,
      device.kind === 'device',
      device.platform,
    ),
    runnerPerformanceBuildSettings: resolveRunnerPerformanceBuildSettings(),
  };
}

export function writeRunnerCacheMetadata(
  derived: string,
  metadata: RunnerXctestrunCacheMetadata,
): void {
  fs.mkdirSync(derived, { recursive: true });
  fs.writeFileSync(
    resolveRunnerCacheMetadataPath(derived),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
}

function readRunnerCacheMetadata(derived: string): RunnerXctestrunCacheMetadata | null {
  try {
    const raw: unknown = JSON.parse(
      fs.readFileSync(resolveRunnerCacheMetadataPath(derived), 'utf8'),
    );
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    return raw as RunnerXctestrunCacheMetadata;
  } catch {
    return null;
  }
}

function evaluateRunnerCacheMetadata(
  derived: string,
  expected: RunnerXctestrunCacheMetadata,
):
  | { ok: true; metadata: RunnerXctestrunCacheMetadata }
  | { ok: false; reason: 'cache_metadata_missing' | 'cache_metadata_mismatch' } {
  const actual = readRunnerCacheMetadata(derived);
  if (!actual) {
    return { ok: false, reason: 'cache_metadata_missing' };
  }
  if (
    JSON.stringify(comparableRunnerCacheMetadata(actual)) !==
    JSON.stringify(comparableRunnerCacheMetadata(expected))
  ) {
    return { ok: false, reason: 'cache_metadata_mismatch' };
  }
  return { ok: true, metadata: actual };
}

function comparableRunnerCacheMetadata(
  metadata: RunnerXctestrunCacheMetadata,
): RunnerXctestrunCacheMetadata {
  const { artifacts: _artifacts, ...comparable } = metadata;
  return comparable;
}

function withRunnerCacheArtifacts(
  metadata: RunnerXctestrunCacheMetadata,
  xctestrunPath: string,
  productPaths: readonly string[],
): RunnerXctestrunCacheMetadata {
  const artifacts = buildRunnerCacheArtifacts(xctestrunPath, productPaths);
  return artifacts ? { ...metadata, artifacts } : metadata;
}

function buildRunnerCacheArtifacts(
  xctestrunPath: string,
  productPaths: readonly string[],
): RunnerXctestrunCacheArtifacts | null {
  const xctestrunMtimeMs = readFileMtimeMs(xctestrunPath);
  if (xctestrunMtimeMs === null || productPaths.length === 0) {
    return null;
  }
  const productArtifacts: RunnerXctestrunCacheProductArtifact[] = [];
  for (const productPath of productPaths) {
    const mtimeMs = readFileMtimeMs(productPath);
    if (mtimeMs === null) {
      return null;
    }
    productArtifacts.push({ path: productPath, mtimeMs });
  }
  return {
    xctestrunPath,
    xctestrunMtimeMs,
    productPaths: productArtifacts,
  };
}

function readValidatedRunnerCacheArtifacts(
  metadata: RunnerXctestrunCacheMetadata | null,
): { xctestrunPath: string; productPaths: string[] } | null {
  const artifacts = metadata?.artifacts;
  if (!isRunnerCacheArtifacts(artifacts)) {
    return null;
  }
  if (readFileMtimeMs(artifacts.xctestrunPath) !== artifacts.xctestrunMtimeMs) {
    return null;
  }
  const productPaths: string[] = [];
  for (const product of artifacts.productPaths) {
    if (readFileMtimeMs(product.path) !== product.mtimeMs) {
      return null;
    }
    productPaths.push(product.path);
  }
  return { xctestrunPath: artifacts.xctestrunPath, productPaths };
}

function isRunnerCacheArtifacts(value: unknown): value is RunnerXctestrunCacheArtifacts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const artifacts = value as Partial<RunnerXctestrunCacheArtifacts>;
  return (
    typeof artifacts.xctestrunPath === 'string' &&
    Number.isInteger(artifacts.xctestrunMtimeMs) &&
    Array.isArray(artifacts.productPaths) &&
    artifacts.productPaths.length > 0 &&
    artifacts.productPaths.every(isRunnerCacheProductArtifact)
  );
}

function isRunnerCacheProductArtifact(
  value: unknown,
): value is RunnerXctestrunCacheProductArtifact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const product = value as Partial<RunnerXctestrunCacheProductArtifact>;
  return typeof product.path === 'string' && Number.isInteger(product.mtimeMs);
}

function readFileMtimeMs(filePath: string): number | null {
  try {
    return Math.trunc(fs.statSync(filePath).mtimeMs);
  } catch {
    return null;
  }
}

type RunnerSourceFingerprintCacheEntry = {
  fileStatsFingerprint: string;
  sourceFingerprint: string;
};

const runnerSourceFingerprintCache = new Map<string, RunnerSourceFingerprintCacheEntry>();

function computeRunnerSourceFingerprint(projectRoot: string): string {
  const runnerRoot = path.join(projectRoot, 'ios-runner', 'AgentDeviceRunner');
  const files = collectRunnerSourceFiles(runnerRoot);
  const fileStatsFingerprint = computeRunnerSourceFileStatsFingerprint(runnerRoot, files);
  const cached = runnerSourceFingerprintCache.get(runnerRoot);
  if (cached?.fileStatsFingerprint === fileStatsFingerprint) {
    return cached.sourceFingerprint;
  }
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relativePath = path.relative(runnerRoot, file);
    hash.update(relativePath);
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  const sourceFingerprint = hash.digest('hex');
  runnerSourceFingerprintCache.set(runnerRoot, { fileStatsFingerprint, sourceFingerprint });
  return sourceFingerprint;
}

function computeRunnerSourceFileStatsFingerprint(
  runnerRoot: string,
  files: readonly string[],
): string {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const relativePath = path.relative(runnerRoot, file);
    const stat = fs.statSync(file);
    hash.update(relativePath);
    hash.update('\0');
    hash.update(String(stat.size));
    hash.update('\0');
    hash.update(String(Math.trunc(stat.mtimeMs)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function collectRunnerSourceFiles(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }
  const files: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'xcuserdata') continue;
        stack.push(fullPath);
        continue;
      }
      if (entry.isFile() && isRunnerSourceFile(entry.name, fullPath)) {
        files.push(fullPath);
      }
    }
  }
  return files.sort((a, b) => a.localeCompare(b));
}

function isRunnerSourceFile(fileName: string, filePath: string): boolean {
  if (fileName === 'project.pbxproj') {
    return filePath.includes(`${path.sep}.xcodeproj${path.sep}`);
  }
  return [
    '.jpg',
    '.json',
    '.png',
    '.swift',
    '.plist',
    '.entitlements',
    '.xctestplan',
    '.xcconfig',
    '.storyboard',
    '.xib',
  ].includes(path.extname(fileName));
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
        } catch {}
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
    } catch {}
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

export async function prepareXctestrunWithEnv(
  xctestrunPath: string,
  envVars: Record<string, string>,
  suffix: string,
): Promise<{ xctestrunPath: string; jsonPath: string }> {
  const dir = path.dirname(xctestrunPath);
  const safeSuffix = suffix.replace(/[^a-zA-Z0-9._-]/g, '_');
  const tmpJsonPath = path.join(dir, `AgentDeviceRunner.env.${safeSuffix}.json`);
  const tmpXctestrunPath = path.join(dir, `AgentDeviceRunner.env.${safeSuffix}.xctestrun`);
  const parsed = await readXctestrunPlist(xctestrunPath);

  visitXctestrunTargets(parsed, (target) => mergeEnvIntoXctestrunTarget(target, envVars));
  // Xcode 26.2 can emit attachment lifetime values that differ from the test plan,
  // so normalize the per-session xctestrun immediately before test-without-building.
  applyRunnerXctestrunCapturePolicy(parsed);
  await writeXctestrunPlist(parsed, tmpJsonPath, tmpXctestrunPath);

  return { xctestrunPath: tmpXctestrunPath, jsonPath: tmpJsonPath };
}

async function readXctestrunPlist(xctestrunPath: string): Promise<XctestrunPlist> {
  const jsonResult = await runAppleToolCommand(
    'plutil',
    ['-convert', 'json', '-o', '-', xctestrunPath],
    {
      allowFailure: true,
    },
  );
  if (jsonResult.exitCode !== 0 || !jsonResult.stdout.trim()) {
    throw new AppError('COMMAND_FAILED', 'Failed to read xctestrun plist', {
      xctestrunPath,
      stderr: jsonResult.stderr,
    });
  }

  try {
    const raw: unknown = JSON.parse(jsonResult.stdout);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Root must be an object');
    }
    return raw as XctestrunPlist;
  } catch (err) {
    throw new AppError('COMMAND_FAILED', 'Failed to parse xctestrun JSON', {
      xctestrunPath,
      error: String(err),
    });
  }
}

async function writeXctestrunPlist(
  parsed: XctestrunPlist,
  tmpJsonPath: string,
  tmpXctestrunPath: string,
): Promise<void> {
  fs.writeFileSync(tmpJsonPath, JSON.stringify(parsed, null, 2));
  const plistResult = await runAppleToolCommand(
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
}

function mergeEnvIntoXctestrunTarget(
  target: XctestrunTarget,
  envVars: Record<string, string>,
): void {
  target.EnvironmentVariables = { ...(target.EnvironmentVariables ?? {}), ...envVars };
  target.UITestEnvironmentVariables = { ...(target.UITestEnvironmentVariables ?? {}), ...envVars };
  target.UITargetAppEnvironmentVariables = {
    ...(target.UITargetAppEnvironmentVariables ?? {}),
    ...envVars,
  };
  target.TestingEnvironmentVariables = {
    ...(target.TestingEnvironmentVariables ?? {}),
    ...envVars,
  };
}

function applyRunnerXctestrunCapturePolicy(parsed: XctestrunPlist): void {
  visitXctestrunTargets(
    parsed,
    (target) => Object.assign(target, RUNNER_XCTESTRUN_CAPTURE_OPTIONS),
    { requireTestBundlePath: true },
  );
}

function visitXctestrunTargets(
  parsed: XctestrunPlist,
  visit: (target: XctestrunTarget) => void,
  options: XctestrunTargetVisitOptions = {},
): void {
  const configs = parsed.TestConfigurations;
  if (Array.isArray(configs)) {
    for (const config of configs as XctestrunConfig[]) {
      if (!config || typeof config !== 'object') continue;
      visitTargets(config.TestTargets, visit, options);
    }
  }

  for (const value of Object.values(parsed)) {
    const target = toXctestrunTarget(value, { requireTestBundlePath: true });
    if (target) visit(target);
  }
}

function visitTargets(
  targets: unknown,
  visit: (target: XctestrunTarget) => void,
  options: XctestrunTargetVisitOptions,
): void {
  if (!Array.isArray(targets)) return;
  for (const target of targets) {
    const parsed = toXctestrunTarget(target, options);
    if (parsed) visit(parsed);
  }
}

function toXctestrunTarget(
  value: unknown,
  options: XctestrunTargetVisitOptions,
): XctestrunTarget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const target = value as XctestrunTarget;
  if (options.requireTestBundlePath && !target.TestBundlePath) return null;
  return target;
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
    const hint = resolveRunnerBuildFailureHint(appErr);
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

function resolveRunnerBuildDestinationFamily(device: DeviceInfo): string {
  const platformName = resolveRunnerPlatformName(device);
  if (platformName === 'macOS') {
    return `platform=macOS,arch=${resolveMacRunnerArch()}`;
  }
  if (device.kind === 'simulator') {
    return `generic/platform=${platformName} Simulator`;
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
  if (isPathInsideProjectTmp(derivedPath)) {
    return;
  }
  throw new AppError(
    'COMMAND_FAILED',
    'Refusing to clean AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH automatically',
    {
      derivedPath,
      hint: `Unset AGENT_DEVICE_IOS_CLEAN_DERIVED, or move AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH under a subdirectory of ${path.join(findProjectRoot(), '.tmp')}.`,
    },
  );
}

function isPathInsideProjectTmp(targetPath: string): boolean {
  const projectTmpRoot = path.resolve(findProjectRoot(), '.tmp');
  const relativePath = path.relative(projectTmpRoot, path.resolve(targetPath));
  return relativePath !== '' && !relativePath.startsWith('..') && !path.isAbsolute(relativePath);
}

type ExistingXctestrunState =
  | {
      reason: 'missing_xctestrun';
      xctestrunPath: null;
    }
  | {
      reason:
        | 'project_root_mismatch'
        | 'missing_products'
        | 'cache_metadata_missing'
        | 'cache_metadata_mismatch'
        | 'reuse_ready';
      xctestrunPath: string;
      productPaths: string[];
    };

// fallow-ignore-next-line complexity
async function evaluateExistingXctestrun(options: {
  derived: string;
  projectRoot: string;
  expectedCacheMetadata: RunnerXctestrunCacheMetadata;
  findXctestrun: (root: string) => string | null;
  xctestrunReferencesProjectRoot: (xctestrunPath: string, projectRoot: string) => boolean;
  resolveExistingXctestrunProductPaths: (xctestrunPath: string) => Promise<string[] | null>;
}): Promise<ExistingXctestrunState> {
  const cacheMetadata = evaluateRunnerCacheMetadata(options.derived, options.expectedCacheMetadata);
  const manifest = cacheMetadata.ok
    ? readValidatedRunnerCacheArtifacts(cacheMetadata.metadata)
    : null;
  const xctestrunPath = manifest?.xctestrunPath ?? options.findXctestrun(options.derived);
  if (!xctestrunPath) {
    return { reason: 'missing_xctestrun', xctestrunPath: null };
  }
  const productPaths =
    manifest?.xctestrunPath === xctestrunPath
      ? manifest.productPaths
      : await options.resolveExistingXctestrunProductPaths(xctestrunPath);
  if (!productPaths) {
    return { reason: 'missing_products', xctestrunPath, productPaths: [] };
  }
  if (!options.xctestrunReferencesProjectRoot(xctestrunPath, options.projectRoot)) {
    return { reason: 'project_root_mismatch', xctestrunPath, productPaths };
  }
  if (!cacheMetadata.ok) {
    return { reason: cacheMetadata.reason, xctestrunPath, productPaths };
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
    | 'cache_metadata_missing'
    | 'cache_metadata_mismatch'
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
