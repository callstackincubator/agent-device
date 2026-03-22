import { AppError } from '../utils/errors.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionState, DaemonRequest } from './types.ts';
import {
  formatSessionSelectorConflict,
  listSessionSelectorConflicts,
  type SessionSelectorConflict,
  type SessionSelectorConflictKey,
} from './session-selector.ts';
import { isApplePlatform, normalizePlatformSelector } from '../utils/device.ts';

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
    `${req.command} cannot override session lock policy with ${conflicts.map(formatSessionSelectorConflict).join(', ')}. ` +
      'Unset those selectors or remove the request lock policy.',
  );
}

function listFreshSessionConflicts(
  flags: CommandFlags,
  lockPlatform: LockPlatform,
): SessionSelectorConflict[] {
  const conflicts: SessionSelectorConflict[] = [];
  const normalizedLockPlatform = normalizePlatformSelector(lockPlatform);
  if (
    flags.platform !== undefined &&
    normalizedLockPlatform &&
    platformSelectorsConflict(normalizePlatformSelector(flags.platform), normalizedLockPlatform)
  ) {
    conflicts.push({ key: 'platform', value: flags.platform });
  }
  for (const key of LOCKABLE_SELECTOR_KEYS) {
    const value = flags[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      conflicts.push({ key: key as SessionSelectorConflictKey, value });
    }
  }
  return conflicts;
}

function platformSelectorsConflict(
  requested: ReturnType<typeof normalizePlatformSelector>,
  locked: ReturnType<typeof normalizePlatformSelector>,
): boolean {
  if (!requested || !locked) return false;
  if (requested === locked) return false;
  if (requested === 'apple') return !isApplePlatform(locked);
  if (locked === 'apple') return !isApplePlatform(requested);
  return true;
}

function stripFreshSessionConflicts(flags: CommandFlags, lockPlatform: LockPlatform): void {
  for (const key of LOCKABLE_SELECTOR_KEYS) {
    delete flags[key];
  }
  if (lockPlatform) {
    flags.platform = lockPlatform;
  }
}

function stripSessionConflicts(flags: CommandFlags, conflicts: SessionSelectorConflict[]): void {
  for (const conflict of conflicts) {
    delete flags[conflict.key];
  }
}
