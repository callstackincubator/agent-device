import { isApplePlatform, type DeviceInfo } from '../utils/device.ts';

type KindMatrix = {
  simulator?: boolean;
  device?: boolean;
  emulator?: boolean;
  unknown?: boolean;
};

type CommandCapability = {
  apple?: KindMatrix;
  android?: KindMatrix;
  supports?: (device: DeviceInfo) => boolean;
};

const isNotMacOs = (device: DeviceInfo): boolean => device.platform !== 'macos';
const isMacOsOrAppleSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'macos' || device.kind === 'simulator';

const COMMAND_CAPABILITY_MATRIX: Record<string, CommandCapability> = {
  // Apple simulator-only.
  alert: {
    // macOS desktop targets report kind=device, so this stays enabled here and the
    // supports() guard excludes iOS physical devices.
    apple: { simulator: true, device: true },
    android: {},
    supports: isMacOsOrAppleSimulator,
  },
  pinch: {
    apple: { simulator: true },
    android: {},
  },
  'app-switcher': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  apps: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  back: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  boot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  click: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  clipboard: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: (device) =>
      device.platform === 'android' || device.platform === 'macos' || device.kind === 'simulator',
  },
  keyboard: { apple: {}, android: { emulator: true, device: true, unknown: true } },
  close: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  fill: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  diff: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  find: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  focus: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  get: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  is: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  home: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  logs: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  network: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  longpress: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  open: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  perf: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  install: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  'install-from-source': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  reinstall: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  press: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  push: {
    apple: { simulator: true },
    android: { emulator: true, device: true, unknown: true },
    supports: isNotMacOs,
  },
  record: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  screenshot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  scroll: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  scrollintoview: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  swipe: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  settings: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    supports: (device) =>
      device.platform === 'android' || device.platform === 'macos' || device.kind === 'simulator',
  },
  snapshot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  'trigger-app-event': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  type: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
  wait: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
  },
};

export function isCommandSupportedOnDevice(command: string, device: DeviceInfo): boolean {
  const capability = COMMAND_CAPABILITY_MATRIX[command];
  if (!capability) return true;
  const byPlatform = isApplePlatform(device.platform) ? capability.apple : capability.android;
  if (!byPlatform) return false;
  if (capability.supports && !capability.supports(device)) return false;
  const kind = (device.kind ?? 'unknown') as keyof KindMatrix;
  return byPlatform[kind] === true;
}

export function listCapabilityCommands(): string[] {
  return Object.keys(COMMAND_CAPABILITY_MATRIX).sort();
}
