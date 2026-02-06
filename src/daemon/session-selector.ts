import { AppError } from '../utils/errors.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionState } from './types.ts';

export function assertSessionSelectorMatches(
  session: SessionState,
  flags?: CommandFlags,
): void {
  if (!flags) return;

  const mismatches: string[] = [];
  const device = session.device;

  if (flags.platform && flags.platform !== device.platform) {
    mismatches.push(`--platform=${flags.platform}`);
  }

  if (flags.udid && (device.platform !== 'ios' || flags.udid !== device.id)) {
    mismatches.push(`--udid=${flags.udid}`);
  }

  if (flags.serial && (device.platform !== 'android' || flags.serial !== device.id)) {
    mismatches.push(`--serial=${flags.serial}`);
  }

  if (mismatches.length === 0) return;

  throw new AppError(
    'INVALID_ARGS',
    `Session "${session.name}" is bound to ${describeDevice(session)} and cannot be used with ${mismatches.join(', ')}. Use a different --session name or close this session first.`,
  );
}

function describeDevice(session: SessionState): string {
  const platform = session.device.platform;
  const name = session.device.name.trim();
  const id = session.device.id;
  return `${platform} device "${name}" (${id})`;
}
