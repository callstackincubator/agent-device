import { AppError } from '../utils/errors.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionState, DaemonRequest } from './types.ts';
import { PUBLIC_COMMANDS } from '../command-catalog.ts';
import {
  formatSessionSelectorConflict,
  listSessionSelectorConflicts,
  type SessionSelectorConflict,
  type SessionSelectorConflictKey,
} from './session-selector.ts';
import { isApplePlatform, normalizePlatformSelector } from '../utils/device.ts';

type LockPlatform = NonNullable<DaemonRequest['meta']>['lockPlatform'];

type LockPolicyContext = {
  allowsSelectorOverride: boolean;
  conflicts: SessionSelectorConflict[];
  lockPlatform: LockPlatform;
};

const LOCKABLE_SELECTOR_KEYS: Array<keyof CommandFlags> = [
  'target',
  'device',
  'udid',
  'serial',
  'iosSimulatorDeviceSet',
  'androidDeviceAllowlist',
];

const SELECTOR_OVERRIDE_LOCK_POLICY_COMMANDS: ReadonlySet<string> = new Set([
  PUBLIC_COMMANDS.apps,
  PUBLIC_COMMANDS.devices,
]);

export function applyRequestLockPolicy(
  req: DaemonRequest,
  existingSession?: SessionState,
): DaemonRequest {
  const lockPolicy = req.meta?.lockPolicy;
  if (!lockPolicy) {
    return req;
  }

  const nextFlags: CommandFlags = { ...(req.flags ?? {}) };
  const context = resolveLockPolicyContext(req, existingSession, nextFlags);

  if (context.conflicts.length === 0) {
    if (shouldApplyLockPlatformDefault(context, existingSession, nextFlags)) {
      nextFlags.platform = context.lockPlatform;
    }
    return {
      ...req,
      flags: nextFlags,
    };
  }

  if (lockPolicy === 'strip') {
    applyStripLockPolicy(nextFlags, context, existingSession);
    return {
      ...req,
      flags: nextFlags,
    };
  }

  throw new AppError(
    'INVALID_ARGS',
    `${req.command} cannot override session lock policy with ${context.conflicts.map(formatSessionSelectorConflict).join(', ')}. ` +
      'Unset those selectors or remove the request lock policy.',
  );
}

function resolveLockPolicyContext(
  req: DaemonRequest,
  existingSession: SessionState | undefined,
  flags: CommandFlags,
): LockPolicyContext {
  const allowsSelectorOverride = SELECTOR_OVERRIDE_LOCK_POLICY_COMMANDS.has(req.command);
  return {
    allowsSelectorOverride,
    conflicts: listLockPolicyConflicts(req, existingSession, flags, allowsSelectorOverride),
    lockPlatform: req.meta?.lockPlatform,
  };
}

function listLockPolicyConflicts(
  req: DaemonRequest,
  existingSession: SessionState | undefined,
  flags: CommandFlags,
  allowsSelectorOverride: boolean,
): SessionSelectorConflict[] {
  if (allowsSelectorOverride) return [];
  return existingSession
    ? listSessionSelectorConflicts(existingSession, flags)
    : listFreshSessionConflicts(flags, req.meta?.lockPlatform, req.command);
}

function shouldApplyLockPlatformDefault(
  context: LockPolicyContext,
  existingSession: SessionState | undefined,
  flags: CommandFlags,
): boolean {
  if (!context.lockPlatform || existingSession || flags.platform !== undefined) {
    return false;
  }
  if (!context.allowsSelectorOverride) {
    return true;
  }
  return flags.serial === undefined && flags.androidDeviceAllowlist === undefined;
}

function applyStripLockPolicy(
  flags: CommandFlags,
  context: LockPolicyContext,
  existingSession: SessionState | undefined,
): void {
  if (existingSession) {
    stripSessionConflicts(flags, context.conflicts);
    flags.platform = existingSession.device.platform;
    return;
  }
  stripFreshSessionConflicts(flags, context.lockPlatform);
}

function listFreshSessionConflicts(
  flags: CommandFlags,
  lockPlatform: LockPlatform,
  command: DaemonRequest['command'],
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
  if (command === 'open') {
    return conflicts;
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
