import { AppError } from '../utils/errors.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionState, DaemonRequest } from './types.ts';
import { listSessionSelectorConflicts } from './session-selector.ts';
import { normalizePlatformSelector } from '../utils/device.ts';

type LockPlatform = NonNullable<DaemonRequest['meta']>['lockPlatform'];

const LOCKABLE_SELECTOR_KEYS: Array<keyof CommandFlags> = [
  'target',
  'device',
  'udid',
  'serial',
  'iosSimulatorDeviceSet',
  'androidDeviceAllowlist',
];

export function applyRequestLockPolicy(
  req: DaemonRequest,
  existingSession?: SessionState,
): DaemonRequest {
  const lockPolicy = req.meta?.lockPolicy;
  if (!lockPolicy) {
    return req;
  }

  const nextFlags: CommandFlags = { ...(req.flags ?? {}) };
  const conflicts = existingSession
    ? listSessionSelectorConflicts(existingSession, nextFlags)
    : listFreshSessionConflicts(nextFlags, req.meta?.lockPlatform);

  if (conflicts.length === 0) {
    if (!existingSession && req.meta?.lockPlatform && nextFlags.platform === undefined) {
      nextFlags.platform = req.meta.lockPlatform;
    }
    return {
      ...req,
      flags: nextFlags,
    };
  }

  if (lockPolicy === 'strip') {
    if (existingSession) {
      stripSessionConflicts(nextFlags, conflicts);
      nextFlags.platform = existingSession.device.platform;
    } else {
      stripFreshSessionConflicts(nextFlags, req.meta?.lockPlatform);
    }
    return {
      ...req,
      flags: nextFlags,
    };
  }

  throw new AppError(
    'INVALID_ARGS',
    `${req.command} cannot override session lock policy with ${conflicts.join(', ')}. ` +
      'Unset those selectors or remove the request lock policy.',
  );
}

function listFreshSessionConflicts(
  flags: CommandFlags,
  lockPlatform: LockPlatform,
): string[] {
  const conflicts: string[] = [];
  const normalizedLockPlatform = normalizePlatformSelector(lockPlatform);
  if (
    flags.platform !== undefined
    && normalizedLockPlatform
    && normalizePlatformSelector(flags.platform) !== normalizedLockPlatform
  ) {
    conflicts.push(`--platform=${flags.platform}`);
  }
  for (const key of LOCKABLE_SELECTOR_KEYS) {
    const value = flags[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      conflicts.push(`${flagNameForKey(key)}=${value}`);
    }
  }
  return conflicts;
}

function stripFreshSessionConflicts(
  flags: CommandFlags,
  lockPlatform: LockPlatform,
): void {
  for (const key of LOCKABLE_SELECTOR_KEYS) {
    delete flags[key];
  }
  if (lockPlatform) {
    flags.platform = lockPlatform;
  }
}

function stripSessionConflicts(flags: CommandFlags, conflicts: string[]): void {
  for (const conflict of conflicts) {
    if (conflict.startsWith('--platform=')) {
      delete flags.platform;
      continue;
    }
    const key = flagKeyForName(conflict.slice(0, conflict.indexOf('=')));
    if (key) {
      delete flags[key];
    }
  }
}

function flagNameForKey(key: keyof CommandFlags): string {
  switch (key) {
    case 'iosSimulatorDeviceSet':
      return '--ios-simulator-device-set';
    case 'androidDeviceAllowlist':
      return '--android-device-allowlist';
    default:
      return `--${key}`;
  }
}

function flagKeyForName(name: string): keyof CommandFlags | undefined {
  switch (name) {
    case '--platform':
      return 'platform';
    case '--target':
      return 'target';
    case '--device':
      return 'device';
    case '--udid':
      return 'udid';
    case '--serial':
      return 'serial';
    case '--ios-simulator-device-set':
      return 'iosSimulatorDeviceSet';
    case '--android-device-allowlist':
      return 'androidDeviceAllowlist';
    default:
      return undefined;
  }
}
