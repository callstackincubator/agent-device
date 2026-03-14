import { AppError } from './errors.ts';
import type { CliFlags } from './command-schema.ts';
import { normalizePlatformSelector } from './device.ts';

type BindingConflictMode = 'reject' | 'strip';

type BindingSettings = {
  defaultPlatform?: CliFlags['platform'];
  lockMode?: BindingConflictMode;
};

type BindingPolicyOverrides = Pick<Partial<CliFlags>, 'sessionLock' | 'sessionLocked' | 'sessionLockConflicts'>;

type LockableFlags = Pick<
  Partial<CliFlags>,
  'platform' | 'target' | 'device' | 'udid' | 'serial' | 'iosSimulatorDeviceSet' | 'androidDeviceAllowlist'
>;

type BindingOptions = {
  env?: NodeJS.ProcessEnv;
  policyOverrides?: BindingPolicyOverrides;
  inheritedPlatform?: CliFlags['platform'];
};

const LOCKED_SELECTOR_KEYS: Array<keyof LockableFlags> = [
  'target',
  'device',
  'udid',
  'serial',
  'iosSimulatorDeviceSet',
  'androidDeviceAllowlist',
];

export function applyConfiguredSessionBinding<T extends LockableFlags>(
  commandLabel: string,
  flags: T,
  options: BindingOptions = {},
): T {
  const settings = resolveBindingSettings(options);
  const nextFlags = { ...flags };

  if (settings.defaultPlatform && nextFlags.platform === undefined) {
    nextFlags.platform = settings.defaultPlatform as T['platform'];
  }

  if (!settings.lockMode) {
    return nextFlags;
  }

  const conflicts: string[] = [];
  const normalizedConfiguredPlatform = normalizePlatformSelector(settings.defaultPlatform);
  if (flags.platform !== undefined) {
    if (!normalizedConfiguredPlatform || normalizePlatformSelector(flags.platform) !== normalizedConfiguredPlatform) {
      conflicts.push(`--platform=${flags.platform}`);
    }
  }

  for (const key of LOCKED_SELECTOR_KEYS) {
    const value = flags[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      conflicts.push(`${flagNameForKey(key)}=${value}`);
    }
  }

  if (conflicts.length === 0) {
    return nextFlags;
  }

  if (settings.lockMode === 'strip') {
    if (settings.defaultPlatform) {
      nextFlags.platform = settings.defaultPlatform as T['platform'];
    }
    for (const key of LOCKED_SELECTOR_KEYS) {
      delete nextFlags[key];
    }
    return nextFlags;
  }

  throw new AppError(
    'INVALID_ARGS',
    `${commandLabel} cannot override session-locked device binding with ${conflicts.join(', ')}. ` +
      'Unset those selectors or remove the bound-session lock policy.',
  );
}

function resolveBindingSettings(options: BindingOptions): BindingSettings {
  const env = options.env ?? process.env;
  const defaultPlatform = options.inheritedPlatform ?? readConfiguredPlatform(env.AGENT_DEVICE_PLATFORM);
  const defaultSessionConfigured = hasConfiguredSession(env.AGENT_DEVICE_SESSION);
  const lockMode = resolveLockMode(options.policyOverrides, env, defaultSessionConfigured);
  return {
    defaultPlatform,
    lockMode,
  };
}

function resolveLockMode(
  overrides: BindingPolicyOverrides | undefined,
  env: NodeJS.ProcessEnv,
  defaultSessionConfigured: boolean,
): BindingConflictMode | undefined {
  const explicitPolicy =
    overrides?.sessionLock
    ?? overrides?.sessionLockConflicts
    ?? readConflictMode(env.AGENT_DEVICE_SESSION_LOCK)
    ?? readConflictMode(env.AGENT_DEVICE_SESSION_LOCK_CONFLICTS);
  if (explicitPolicy) {
    return explicitPolicy;
  }
  if (overrides?.sessionLocked === true || isEnvTruthy(env.AGENT_DEVICE_SESSION_LOCKED) || defaultSessionConfigured) {
    return 'reject';
  }
  return undefined;
}

function readConfiguredPlatform(raw: string | undefined): CliFlags['platform'] | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'ios' || value === 'android' || value === 'apple') {
    return value;
  }
  throw new AppError(
    'INVALID_ARGS',
    `Invalid AGENT_DEVICE_PLATFORM: ${raw}. Use ios, android, or apple.`,
  );
}

function readConflictMode(raw: string | undefined): BindingConflictMode | undefined {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  if (!value) return undefined;
  if (value === 'reject' || value === 'strip') {
    return value;
  }
  throw new AppError(
    'INVALID_ARGS',
    `Invalid session lock mode: ${raw}. Use reject or strip.`,
  );
}

function isEnvTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  switch (raw.trim().toLowerCase()) {
    case '1':
    case 'true':
    case 'yes':
    case 'on':
      return true;
    default:
      return false;
  }
}

function hasConfiguredSession(raw: string | undefined): boolean {
  return typeof raw === 'string' && raw.trim().length > 0;
}

function flagNameForKey(key: keyof LockableFlags): string {
  switch (key) {
    case 'iosSimulatorDeviceSet':
      return '--ios-simulator-device-set';
    case 'androidDeviceAllowlist':
      return '--android-device-allowlist';
    default:
      return `--${key}`;
  }
}
