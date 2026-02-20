import type { DeviceInfo } from '../utils/device.ts';

type KindMatrix = {
  simulator?: boolean;
  device?: boolean;
  emulator?: boolean;
  unknown?: boolean;
};

type CommandCapability = {
  ios?: KindMatrix;
  android?: KindMatrix;
};

const COMMAND_CAPABILITY_MATRIX: Record<string, CommandCapability> = {
  // iOS simulator-only.
  alert: { ios: { simulator: true }, android: {} },
  pinch: { ios: { simulator: true }, android: {} },
  'app-switcher': { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  apps: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  back: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  boot: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  click: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  close: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  fill: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  find: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  focus: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  get: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  is: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  home: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  longpress: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  open: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  reinstall: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  press: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  record: { ios: { simulator: true }, android: { emulator: true, device: true, unknown: true } },
  screenshot: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  scroll: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  scrollintoview: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  swipe: { ios: { simulator: true }, android: { emulator: true, device: true, unknown: true } },
  settings: { ios: { simulator: true }, android: { emulator: true, device: true, unknown: true } },
  snapshot: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  type: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
  wait: { ios: { simulator: true, device: true }, android: { emulator: true, device: true, unknown: true } },
};

export function isCommandSupportedOnDevice(command: string, device: DeviceInfo): boolean {
  const capability = COMMAND_CAPABILITY_MATRIX[command];
  if (!capability) return true;
  const byPlatform = capability[device.platform];
  if (!byPlatform) return false;
  const kind = (device.kind ?? 'unknown') as keyof KindMatrix;
  return byPlatform[kind] === true;
}

export function listCapabilityCommands(): string[] {
  return Object.keys(COMMAND_CAPABILITY_MATRIX).sort();
}
