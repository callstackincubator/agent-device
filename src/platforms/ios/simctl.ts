import type { DeviceInfo } from '../../utils/device.ts';
import { resolveIosSimulatorDeviceSetPath } from '../../utils/device-isolation.ts';

type SimctlArgsOptions = {
  simulatorSetPath?: string;
};

export function buildSimctlArgs(
  args: string[],
  options: SimctlArgsOptions = {},
): string[] {
  const simulatorSetPath = resolveIosSimulatorDeviceSetPath(options.simulatorSetPath);
  if (!simulatorSetPath) return ['simctl', ...args];
  return ['simctl', '--set', simulatorSetPath, ...args];
}

export function buildSimctlArgsForDevice(
  device: DeviceInfo,
  args: string[],
): string[] {
  if (device.platform !== 'ios' || device.kind !== 'simulator') {
    return ['simctl', ...args];
  }
  return buildSimctlArgs(args, { simulatorSetPath: device.simulatorSetPath });
}
