import { AppError } from './errors.ts';

export type ApplePlatform = 'ios' | 'macos';
export type Platform = ApplePlatform | 'android';
export type PlatformSelector = Platform | 'apple';
export type DeviceKind = 'simulator' | 'emulator' | 'device';
export type DeviceTarget = 'mobile' | 'tv' | 'desktop';

export type DeviceInfo = {
  platform: Platform;
  id: string;
  name: string;
  kind: DeviceKind;
  target?: DeviceTarget;
  booted?: boolean;
  simulatorSetPath?: string;
};

type DeviceSelector = {
  platform?: PlatformSelector;
  target?: DeviceTarget;
  deviceName?: string;
  udid?: string;
  serial?: string;
};

type DeviceSelectionContext = {
  simulatorSetPath?: string;
};

export function normalizePlatformSelector(
  platform: PlatformSelector | undefined,
): PlatformSelector | undefined {
  return platform;
}

export function isApplePlatform(
  platform: Platform | PlatformSelector | undefined,
): platform is ApplePlatform | 'apple' {
  return platform === 'apple' || platform === 'ios' || platform === 'macos';
}

export function matchesPlatformSelector(
  platform: Platform,
  selector: PlatformSelector | undefined,
): boolean {
  if (!selector) return true;
  if (selector === 'apple') return isApplePlatform(platform);
  return platform === selector;
}

export function resolveApplePlatformName(
  platformOrTarget: ApplePlatform | DeviceTarget | undefined,
): 'iOS' | 'tvOS' | 'macOS' {
  if (platformOrTarget === 'macos' || platformOrTarget === 'desktop') return 'macOS';
  if (platformOrTarget === 'tv') return 'tvOS';
  return 'iOS';
}

export function resolveAppleSimulatorSetPathForSelector(params: {
  simulatorSetPath?: string;
  platform?: PlatformSelector;
  target?: DeviceTarget;
}): string | undefined {
  const { simulatorSetPath, platform, target } = params;
  if (!simulatorSetPath) return undefined;
  if (platform === 'macos' || target === 'desktop') {
    return undefined;
  }
  return simulatorSetPath;
}

function supportsAppleSimulatorSelection(platform: PlatformSelector | undefined): boolean {
  return !platform || platform === 'apple' || platform === 'ios';
}

export async function resolveDevice(
  devices: DeviceInfo[],
  selector: DeviceSelector,
  context: DeviceSelectionContext = {},
): Promise<DeviceInfo> {
  let candidates = devices;
  const normalize = (value: string): string =>
    value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  if (selector.platform) {
    candidates = candidates.filter((d) => matchesPlatformSelector(d.platform, selector.platform));
  }
  if (selector.target) {
    candidates = candidates.filter((d) => (d.target ?? 'mobile') === selector.target);
  }

  if (selector.udid) {
    const match = candidates.find((d) => d.id === selector.udid && isApplePlatform(d.platform));
    if (!match) {
      throw new AppError('DEVICE_NOT_FOUND', `No Apple device with UDID ${selector.udid}`);
    }
    return match;
  }

  if (selector.serial) {
    const match = candidates.find((d) => d.id === selector.serial && d.platform === 'android');
    if (!match)
      throw new AppError('DEVICE_NOT_FOUND', `No Android device with serial ${selector.serial}`);
    return match;
  }

  if (selector.deviceName) {
    const target = normalize(selector.deviceName);
    const match = candidates.find((d) => normalize(d.name) === target);
    if (!match) {
      throw new AppError('DEVICE_NOT_FOUND', `No device named ${selector.deviceName}`);
    }
    return match;
  }

  if (candidates.length === 1) return candidates[0];

  if (candidates.length === 0) {
    const simulatorSetPath = context.simulatorSetPath;
    if (simulatorSetPath && supportsAppleSimulatorSelection(selector.platform)) {
      throw new AppError('DEVICE_NOT_FOUND', 'No devices found in the scoped simulator set', {
        simulatorSetPath,
        hint: `The simulator set at "${simulatorSetPath}" appears to be empty. Create a simulator first:\n  xcrun simctl --set "${simulatorSetPath}" create "iPhone 16" com.apple.CoreSimulator.SimDeviceType.iPhone-16 com.apple.CoreSimulator.SimRuntime.iOS-18-0`,
        selector,
      });
    }
    throw new AppError('DEVICE_NOT_FOUND', 'No devices found', { selector });
  }

  // Prefer virtual devices (simulators/emulators) over physical devices unless
  // a physical device was explicitly requested via --device/--udid/--serial.
  const virtual = candidates.filter((d) => d.kind !== 'device');
  if (virtual.length > 0) {
    candidates = virtual;
  }

  const booted = candidates.filter((d) => d.booted);
  if (booted.length === 1) return booted[0];

  // When multiple candidates remain equally valid, preserve discovery order from
  // the underlying platform tools rather than introducing another tie-breaker here.
  return booted[0] ?? candidates[0];
}
