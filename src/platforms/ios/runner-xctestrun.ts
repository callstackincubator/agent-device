import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/errors.ts';
import { runCmd, runCmdStreaming, type ExecBackgroundResult } from '../../utils/exec.ts';
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

export async function ensureXctestrun(
  device: DeviceInfo,
  options: { verbose?: boolean; logPath?: string; traceLogPath?: string },
): Promise<string> {
  const derived = resolveRunnerDerivedPath(device.kind);
  return await withKeyedLock(runnerXctestrunBuildLocks, derived, async () => {
    if (shouldCleanDerived()) {
      assertSafeDerivedCleanup(derived);
      try {
        fs.rmSync(derived, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    const existing = findXctestrun(derived, device);
    if (existing) return existing;

    const projectRoot = findProjectRoot();
    const projectPath = path.join(
      projectRoot,
      'ios-runner',
      'AgentDeviceRunner',
      'AgentDeviceRunner.xcodeproj',
    );

    if (!fs.existsSync(projectPath)) {
      throw new AppError('COMMAND_FAILED', 'iOS runner project not found', { projectPath });
    }

    const runnerBundleBuildSettings = resolveRunnerBundleBuildSettings(process.env);
    const signingBuildSettings = resolveRunnerSigningBuildSettings(
      process.env,
      device.kind === 'device',
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

    const built = findXctestrun(derived, device);
    if (!built) {
      throw new AppError('COMMAND_FAILED', 'Failed to locate .xctestrun after build');
    }
    return built;
  });
}

type XctestrunCandidate = {
  path: string;
  mtimeMs: number;
};

export function findXctestrun(root: string, device: DeviceInfo): string | null {
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
  candidates.sort(
    (a, b) =>
      compareXctestrunCandidates(b.path, a.path, device) ||
      b.mtimeMs - a.mtimeMs ||
      a.path.localeCompare(b.path),
  );
  return candidates[0]?.path ?? null;
}

function compareXctestrunCandidates(left: string, right: string, device: DeviceInfo): number {
  return scoreXctestrunCandidate(left, device) - scoreXctestrunCandidate(right, device);
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
  if (device.target === 'tv') {
    if (device.kind === 'simulator') {
      return {
        preferred: ['appletvsimulator'],
        disallowed: ['appletvos', 'iphoneos', 'iphonesimulator'],
      };
    }
    return {
      preferred: ['appletvos'],
      disallowed: ['appletvsimulator', 'iphoneos', 'iphonesimulator'],
    };
  }

  if (device.kind === 'simulator') {
    return {
      preferred: ['iphonesimulator'],
      disallowed: ['iphoneos', 'appletvos', 'appletvsimulator'],
    };
  }

  return {
    preferred: ['iphoneos'],
    disallowed: ['iphonesimulator', 'appletvos', 'appletvsimulator'],
  };
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

function resolveRunnerDerivedPath(kind: DeviceInfo['kind']): string {
  const override = process.env.AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (kind === 'simulator') {
    return path.join(RUNNER_DERIVED_ROOT, 'derived');
  }
  return path.join(RUNNER_DERIVED_ROOT, 'derived', kind);
}

export function resolveRunnerDestination(device: DeviceInfo): string {
  const platformName = resolveRunnerPlatformName(device);
  if (device.kind === 'simulator') {
    return `platform=${platformName} Simulator,id=${device.id}`;
  }
  return `platform=${platformName},id=${device.id}`;
}

export function resolveRunnerBuildDestination(device: DeviceInfo): string {
  const platformName = resolveRunnerPlatformName(device);
  if (device.kind === 'simulator') {
    return `platform=${platformName} Simulator,id=${device.id}`;
  }
  return `generic/platform=${platformName}`;
}

function resolveRunnerPlatformName(device: DeviceInfo): 'iOS' | 'tvOS' {
  if (device.platform !== 'ios') {
    throw new AppError(
      'UNSUPPORTED_PLATFORM',
      `Unsupported platform for iOS runner: ${device.platform}`,
    );
  }
  return resolveApplePlatformName(device.target);
}

export function resolveRunnerMaxConcurrentDestinationsFlag(device: DeviceInfo): string {
  return device.kind === 'device'
    ? '-maximum-concurrent-test-device-destinations'
    : '-maximum-concurrent-test-simulator-destinations';
}

export function resolveRunnerSigningBuildSettings(
  env: NodeJS.ProcessEnv = process.env,
  forDevice = false,
): string[] {
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

function resolveRunnerPerformanceBuildSettings(): string[] {
  return ['COMPILER_INDEX_STORE_ENABLE=NO'];
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
