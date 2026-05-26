import { isApplePlatform, type DeviceInfo } from '../utils/device.ts';

type KindMatrix = {
  simulator?: boolean;
  device?: boolean;
  emulator?: boolean;
  unknown?: boolean;
};

export type CommandCapability = {
  apple?: KindMatrix;
  android?: KindMatrix;
  linux?: KindMatrix;
  supports?: (device: DeviceInfo) => boolean;
};

const isNotMacOs = (device: DeviceInfo): boolean => device.platform !== 'macos';
const isMacOsOrAppleSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'macos' || device.kind === 'simulator';
const isMacOsOrMobileAppleSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'macos' || (device.kind === 'simulator' && device.target !== 'tv');
const isIosMobileSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'ios' && device.kind === 'simulator' && device.target !== 'tv';

// Linux desktop supports these commands via xdotool/ydotool + AT-SPI2.
// Linux device kind is always 'device' (local desktop).
const LINUX_DEVICE: KindMatrix = { device: true };
const LINUX_NONE: KindMatrix = {};
const ALL_DEVICE_COMMAND_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: LINUX_DEVICE,
} as const satisfies CommandCapability;
const APP_RUNTIME_CAPABILITY = ALL_DEVICE_COMMAND_CAPABILITY;
const APP_INVENTORY_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: LINUX_NONE,
} as const satisfies CommandCapability;
const APP_INSTALL_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  linux: LINUX_NONE,
  supports: isNotMacOs,
} as const satisfies CommandCapability;

const COMMAND_CAPABILITY_MATRIX: Record<string, CommandCapability> = {
  // Apple simulator-only.
  alert: {
    // macOS desktop targets report kind=device, so this stays enabled here and the
    // supports() guard excludes iOS physical devices.
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isMacOsOrAppleSimulator(device),
  },
  pinch: {
    // macOS desktop targets report kind=device, so this stays enabled here and the
    // supports() guard excludes iOS physical devices.
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isMacOsOrMobileAppleSimulator(device),
  },
  'rotate-gesture': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isIosMobileSimulator(device),
  },
  'transform-gesture': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isIosMobileSimulator(device),
  },
  'app-switcher': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: isNotMacOs,
  },
  open: APP_RUNTIME_CAPABILITY,
  close: APP_RUNTIME_CAPABILITY,
  reinstall: APP_INSTALL_CAPABILITY,
  install: APP_INSTALL_CAPABILITY,
  'install-from-source': APP_INSTALL_CAPABILITY,
  apps: APP_INVENTORY_CAPABILITY,
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
    // iOS only supports keyboard dismiss/enter; status/get remains Android-only.
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' || (device.platform === 'ios' && device.target !== 'tv'),
  },
  fill: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
  },
  fling: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  snapshot: ALL_DEVICE_COMMAND_CAPABILITY,
  diff: ALL_DEVICE_COMMAND_CAPABILITY,
  screenshot: ALL_DEVICE_COMMAND_CAPABILITY,
  wait: ALL_DEVICE_COMMAND_CAPABILITY,
  get: ALL_DEVICE_COMMAND_CAPABILITY,
  find: ALL_DEVICE_COMMAND_CAPABILITY,
  is: ALL_DEVICE_COMMAND_CAPABILITY,
  focus: {
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
  perf: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  pan: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_DEVICE,
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
  'react-native': {
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
  'trigger-app-event': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
  },
  type: ALL_DEVICE_COMMAND_CAPABILITY,
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
