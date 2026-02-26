import { AppError } from '../utils/errors.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionState } from './types.ts';
import { normalizePlatformSelector } from '../utils/device.ts';
import { parseSerialAllowlist } from '../utils/device-isolation.ts';

export function assertSessionSelectorMatches(
  session: SessionState,
  flags?: CommandFlags,
): void {
  if (!flags) return;

  const mismatches: string[] = [];
  const device = session.device;

  const normalizedPlatform = normalizePlatformSelector(flags.platform);
  if (normalizedPlatform && normalizedPlatform !== device.platform) {
    mismatches.push(`--platform=${flags.platform}`);
  }
  if (flags.target && flags.target !== (device.target ?? 'mobile')) {
    mismatches.push(`--target=${flags.target}`);
  }

  if (flags.udid && (device.platform !== 'ios' || flags.udid !== device.id)) {
    mismatches.push(`--udid=${flags.udid}`);
  }

  if (flags.serial && (device.platform !== 'android' || flags.serial !== device.id)) {
    mismatches.push(`--serial=${flags.serial}`);
  }

  if (flags.device && flags.device.trim().toLowerCase() !== device.name.trim().toLowerCase()) {
    mismatches.push(`--device=${flags.device}`);
  }

  if (flags.iosSimulatorDeviceSet) {
    const requestedSetPath = flags.iosSimulatorDeviceSet.trim();
    const sessionSetPath = device.simulatorSetPath?.trim();
    if (
      device.platform !== 'ios'
      || device.kind !== 'simulator'
      || requestedSetPath !== sessionSetPath
    ) {
      mismatches.push(`--ios-simulator-device-set=${flags.iosSimulatorDeviceSet}`);
    }
  }

  if (flags.androidDeviceAllowlist) {
    const allowlist = parseSerialAllowlist(flags.androidDeviceAllowlist);
    if (device.platform !== 'android' || !allowlist.has(device.id)) {
      mismatches.push(`--android-device-allowlist=${flags.androidDeviceAllowlist}`);
    }
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
