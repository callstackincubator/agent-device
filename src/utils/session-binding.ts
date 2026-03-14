import { AppError } from './errors.ts';
import type { CliFlags } from './command-schema.ts';
import { normalizePlatformSelector } from './device.ts';

type BindingConflictMode = 'reject' | 'strip';

type BindingSettings = {
  defaultPlatform?: CliFlags['platform'];
  sessionLocked: boolean;
  conflictMode: BindingConflictMode;
};

type BindingPolicyOverrides = Pick<Partial<CliFlags>, 'sessionLocked' | 'sessionLockConflicts'>;

type LockableFlags = Pick<
  Partial<CliFlags>,
  'platform' | 'target' | 'device' | 'udid' | 'serial' | 'iosSimulatorDeviceSet' | 'androidDeviceAllowlist'
>;

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
  options: {
    env?: NodeJS.ProcessEnv;
    policyOverrides?: BindingPolicyOverrides;
  } = {},
): T {
  const settings = resolveBindingSettings(options.policyOverrides, options.env);
  const nextFlags = { ...flags };

  if (settings.defaultPlatform && nextFlags.platform === undefined) {
    nextFlags.platform = settings.defaultPlatform as T['platform'];
  }

  if (!settings.sessionLocked) {
    return nextFlags;
  }

  const conflicts: string[] = [];
  const normalizedConfiguredPlatform = normalizePlatformSelector(settings.defaultPlatform);
  if (
    settings.defaultPlatform
    && flags.platform !== undefined
    && normalizePlatformSelector(flags.platform) !== normalizedConfiguredPlatform
  ) {
    conflicts.push(`--platform=${flags.platform}`);
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

  if (settings.conflictMode === 'strip') {
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
      'Unset those selectors or disable AGENT_DEVICE_SESSION_LOCKED.',
  );
}

function resolveBindingSettings(
  policyOverrides: BindingPolicyOverrides | undefined,
  env: NodeJS.ProcessEnv = process.env,
): BindingSettings {
  const defaultPlatform = readConfiguredPlatform(env.AGENT_DEVICE_PLATFORM);
  const sessionLocked = policyOverrides?.sessionLocked ?? isEnvTruthy(env.AGENT_DEVICE_SESSION_LOCKED);
  const conflictMode = policyOverrides?.sessionLockConflicts ?? readConflictMode(env.AGENT_DEVICE_SESSION_LOCK_CONFLICTS);
  return {
    defaultPlatform,
    sessionLocked,
    conflictMode,
  };
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

function readConflictMode(raw: string | undefined): BindingConflictMode {
  if (raw === undefined) return 'reject';
  const value = raw.trim().toLowerCase();
  if (!value) return 'reject';
  if (value === 'reject' || value === 'strip') {
    return value;
  }
  throw new AppError(
    'INVALID_ARGS',
    `Invalid AGENT_DEVICE_SESSION_LOCK_CONFLICTS: ${raw}. Use reject or strip.`,
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
