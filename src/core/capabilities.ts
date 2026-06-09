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
  harmonyos?: KindMatrix;
  linux?: KindMatrix;
  supports?: (device: DeviceInfo) => boolean;
  /** Optional actionable hint surfaced when this command is rejected at admission for `device`. */
  unsupportedHint?: (device: DeviceInfo) => string | undefined;
};

const isNotMacOs = (device: DeviceInfo): boolean => device.platform !== 'macos';
const isMacOsOrAppleSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'macos' || device.kind === 'simulator';
const isIosMobileSimulator = (device: DeviceInfo): boolean =>
  device.platform === 'ios' && device.kind === 'simulator' && device.target !== 'tv';

// Two-finger gesture synthesis (RunnerSynthesizedGesture) is iOS-simulator-only (plus Android).
// When such a gesture is rejected at admission, explain where it IS available so an agent can
// redirect instead of getting a bare "not supported on this device".
const synthesisGestureUnsupportedHint = (device: DeviceInfo): string | undefined => {
  if (device.platform === 'macos')
    return 'macOS automation has no multi-touch input — this gesture is supported on Android and the iOS simulator only.';
  if (device.platform === 'ios' && device.target === 'tv')
    return 'tvOS has no touch input — this gesture is supported on Android and the iOS simulator only.';
  if (device.platform === 'ios' && device.kind === 'device')
    return 'Two-finger gesture synthesis is iOS-simulator only — not available on physical iOS devices.';
  return undefined;
};

// Linux desktop supports these commands via xdotool/ydotool + AT-SPI2.
// Linux device kind is always 'device' (local desktop).
const LINUX_DEVICE: KindMatrix = { device: true };
const LINUX_NONE: KindMatrix = {};
const HARMONYOS_DEVICE: KindMatrix = { device: true };
const ALL_DEVICE_COMMAND_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  harmonyos: HARMONYOS_DEVICE,
  linux: LINUX_DEVICE,
} as const satisfies CommandCapability;
const APP_RUNTIME_CAPABILITY = ALL_DEVICE_COMMAND_CAPABILITY;
const APP_INVENTORY_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  harmonyos: HARMONYOS_DEVICE,
  linux: LINUX_NONE,
} as const satisfies CommandCapability;
const APP_INSTALL_CAPABILITY = {
  apple: { simulator: true, device: true },
  android: { emulator: true, device: true, unknown: true },
  harmonyos: HARMONYOS_DEVICE,
  linux: LINUX_NONE,
  supports: isNotMacOs,
} as const satisfies CommandCapability;

const COMMAND_CAPABILITY_MATRIX: Record<string, CommandCapability> = {
  alert: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || device.platform === 'harmonyos' || isMacOsOrAppleSimulator(device),
  },
  pinch: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isIosMobileSimulator(device),
    unsupportedHint: synthesisGestureUnsupportedHint,
  },
  'rotate-gesture': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isIosMobileSimulator(device),
    unsupportedHint: synthesisGestureUnsupportedHint,
  },
  'transform-gesture': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    linux: LINUX_NONE,
    supports: (device) => device.platform === 'android' || isIosMobileSimulator(device),
    unsupportedHint: synthesisGestureUnsupportedHint,
  },
  'app-switcher': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
    supports: (device) => isNotMacOs(device) || device.platform === 'harmonyos',
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
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  boot: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: {},
    linux: LINUX_NONE,
    supports: (device) => isNotMacOs(device) && device.platform !== 'harmonyos',
  },
  click: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  clipboard: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: {},
    linux: LINUX_DEVICE,
    supports: (device) =>
      device.platform === 'android' ||
      device.platform === 'linux' ||
      device.platform === 'macos' ||
      device.kind === 'simulator',
  },
  keyboard: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' ||
      device.platform === 'harmonyos' ||
      (device.platform === 'ios' && device.target !== 'tv'),
  },
  fill: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  fling: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
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
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  home: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
    supports: (device) => isNotMacOs(device) || device.platform === 'harmonyos',
  },
  logs: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: {},
    linux: LINUX_NONE,
    supports: (device) => device.platform !== 'harmonyos',
  },
  network: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: {},
    linux: LINUX_NONE,
    supports: (device) => device.platform !== 'harmonyos',
  },
  longpress: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  perf: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: {},
    linux: LINUX_NONE,
    supports: (device) => device.platform !== 'harmonyos',
  },
  pan: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  press: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  push: {
    apple: { simulator: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
    supports: (device) => isNotMacOs(device) || device.platform === 'harmonyos',
  },
  record: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
  },
  'react-native': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
  },
  rotate: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' || device.platform === 'harmonyos' || (device.platform === 'ios' && device.target !== 'tv'),
  },
  scroll: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  swipe: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_DEVICE,
  },
  settings: {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
    linux: LINUX_NONE,
    supports: (device) =>
      device.platform === 'android' || device.platform === 'harmonyos' || device.platform === 'macos' || device.kind === 'simulator',
  },
  'trigger-app-event': {
    apple: { simulator: true, device: true },
    android: { emulator: true, device: true, unknown: true },
    harmonyos: HARMONYOS_DEVICE,
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
      : device.platform === 'harmonyos'
        ? capability.harmonyos
        : capability.android;
  if (!byPlatform) return false;
  if (capability.supports && !capability.supports(device)) return false;
  const kind = (device.kind ?? 'unknown') as keyof KindMatrix;
  return byPlatform[kind] === true;
}

export function unsupportedHintForDevice(command: string, device: DeviceInfo): string | undefined {
  return COMMAND_CAPABILITY_MATRIX[command]?.unsupportedHint?.(device);
}

export function listCapabilityCommands(): string[] {
  return Object.keys(COMMAND_CAPABILITY_MATRIX).sort();
}
