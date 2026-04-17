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
  linux?: KindMatrix;
  supports?: (device: DeviceInfo) => boolean;
};

const isNotMacOs = (device: DeviceInfo): boolean => device.platform !== 'macos';
const isMacOsOrAppleSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'macos' || device.kind === 'simulator';

// Linux desktop supports these commands via xdotool/ydotool + AT-SPI2.
// Linux device kind is always 'device' (local desktop).
const LINUX_DEVICE: KindMatrix = { device: true };
const LINUX_NONE: KindMatrix = {};

const COMMAND_CAPABILITY_MATRIX: Record<string, CommandCapability> = {
  // Apple simulator-only.
  alert: {
    // macOS desktop targets report kind=device, so this stays enabled here and the
    // supports() guard excludes iOS physical devices.
    apple: { simulator: true, device: true },
    android: {},
    linux: LINUX_NONE,
    supports: isMacOsOrAppleSimulator,
  },
  pinch: {
    // macOS desktop targets report kind=device, so this stays enabled here and the
    // supports() guard excludes iOS physical devices.
    apple: { simulator: true, device: true },
    android: {},
    linux: LINUX_NONE,
    supports: isMacOsOrAppleSimulator,
  },
  'app-switcher': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  apps: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  back: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  boot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  click: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  clipboard: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
    supports: (device) =>
      device.platform === 'android' ||
      device.platform === 'linux' ||
      device.platform === 'macos' ||
      device.kind === 'simulator',
  },
  keyboard: {
    // iOS only supports keyboard dismiss; status/get remains Android-only.
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' || (device.platform === 'ios' && device.target !== 'tv'),
  },
  close: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  fill: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  diff: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  find: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  focus: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  get: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  is: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  home: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
    supports: isNotMacOs,
  },
  logs: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  network: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  longpress: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  open: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  perf: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  install: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  'install-from-source': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  'run-react-native': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  reinstall: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  press: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  push: {
    apple: { simulator: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  record: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  rotate: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' || (device.platform === 'ios' && device.target !== 'tv'),
  },
  screenshot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  scroll: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  swipe: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  settings: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' || device.platform === 'macos' || device.kind === 'simulator',
  },
  snapshot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  'trigger-app-event': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  type: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  wait: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
};

export function isCommandSupportedOnDevice(command: string, device: DeviceInfo): boolean {
  const capability = COMMAND_CAPABILITY_MATRIX[command];
  if (!capability) return true;
  const byPlatform = isApplePlatform(device.platform)
    ? capability.apple
    : device.platform === 'linux'
      ? capability.linux
      : capability.android;
  if (!byPlatform) return false;
  if (capability.supports && !capability.supports(device)) return false;
  const kind = (device.kind ?? 'unknown') as keyof KindMatrix;
  return byPlatform[kind] === true;
}

export function listCapabilityCommands(): string[] {
  return Object.keys(COMMAND_CAPABILITY_MATRIX).sort();
}
