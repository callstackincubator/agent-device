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
import { buildSessionRecoveryHint, describeSessionDevice } from './session-recovery-hints.ts';
import { shellQuoteIfNeeded } from '../utils/shell-quote.ts';

type LockPlatform = NonNullable<DaemonRequest['meta']>['lockPlatform'];

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
  const canOverrideSelector = SELECTOR_OVERRIDE_LOCK_POLICY_COMMANDS.has(req.command);
  const conflicts = canOverrideSelector
    ? []
    : existingSession
      ? listSessionSelectorConflicts(existingSession, nextFlags)
      : listFreshSessionConflicts(nextFlags, req.meta?.lockPlatform, req.command);
  const lockPlatform = req.meta?.lockPlatform;

  if (conflicts.length === 0) {
    if (
      shouldApplyLockPlatformDefault(canOverrideSelector, existingSession, nextFlags, lockPlatform)
    ) {
      nextFlags.platform = lockPlatform;
    }
    return {
      ...req,
      flags: nextFlags,
    };
  }

  if (lockPolicy === 'strip') {
    applyStripLockPolicy(nextFlags, conflicts, lockPlatform, existingSession);
    return {
      ...req,
      flags: nextFlags,
    };
  }

  throw new AppError(
    'INVALID_ARGS',
    buildLockPolicyConflictMessage(req, conflicts, existingSession),
    {
      session: req.session,
      conflicts: conflicts.map(formatSessionSelectorConflict),
      hint: buildLockPolicyConflictHint(req, existingSession),
    },
  );
}

function buildLockPolicyConflictMessage(
  req: DaemonRequest,
  conflicts: SessionSelectorConflict[],
  existingSession: SessionState | undefined,
): string {
  const conflictList = conflicts.map(formatSessionSelectorConflict).join(', ');
  if (existingSession) {
    return (
      `${req.command} is already bound to session "${existingSession.name}" on ${describeSessionDevice(existingSession)}, ` +
      `but this request selected ${conflictList}.`
    );
  }
  const lockPlatform = req.meta?.lockPlatform;
  const platformText = lockPlatform ? ` for ${lockPlatform}` : '';
  return `${req.command} is using a bound-session lock${platformText}, but this request selected ${conflictList}.`;
}

function buildLockPolicyConflictHint(
  req: DaemonRequest,
  existingSession: SessionState | undefined,
): string {
  if (existingSession) {
    return buildSessionRecoveryHint(existingSession, 'selector-conflict');
  }
  const lockPlatform = req.meta?.lockPlatform;
  const sessionText = req.session ? ` --session ${shellQuoteIfNeeded(req.session)}` : '';
  const openText = lockPlatform
    ? `Run agent-device open <app>${sessionText} --platform ${lockPlatform} first if no session is active. `
    : `Run agent-device open <app>${sessionText} first if no session is active. `;
  return (
    `Remove conflicting device selectors from this command, or use --session-lock strip to let agent-device ignore them. ` +
    openText +
    `Run agent-device session list to inspect active sessions.`
  );
}

function shouldApplyLockPlatformDefault(
  canOverrideSelector: boolean,
  existingSession: SessionState | undefined,
  flags: CommandFlags,
  lockPlatform: LockPlatform,
): boolean {
  if (!lockPlatform || existingSession || flags.platform !== undefined) {
    return false;
  }
  if (!canOverrideSelector) {
    return true;
  }
  return !LOCKABLE_SELECTOR_KEYS.some((key) => hasSelectorValue(flags[key]));
}

function applyStripLockPolicy(
  flags: CommandFlags,
  conflicts: SessionSelectorConflict[],
  lockPlatform: LockPlatform,
  existingSession: SessionState | undefined,
): void {
  if (existingSession) {
    stripSessionConflicts(flags, conflicts);
    flags.platform = existingSession.device.platform;
    return;
  }
  stripFreshSessionConflicts(flags, lockPlatform);
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
    if (hasSelectorValue(value)) {
      conflicts.push({ key: key as SessionSelectorConflictKey, value });
    }
  }
  return conflicts;
}

function hasSelectorValue(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
