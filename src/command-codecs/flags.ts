import type { CliFlags } from '../utils/command-schema.ts';

export type SelectionOptions = {
  platform?: CliFlags['platform'];
  target?: CliFlags['target'];
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
};

export function selectionOptionsFromFlags(flags: CliFlags): SelectionOptions {
  return {
    platform: flags.platform,
    target: flags.target,
    device: flags.device,
    udid: flags.udid,
    serial: flags.serial,
    iosSimulatorDeviceSet: flags.iosSimulatorDeviceSet,
    androidDeviceAllowlist: flags.androidDeviceAllowlist,
  };
}

export function selectorSnapshotOptionsFromFlags(flags: CliFlags): {
  depth?: number;
  scope?: string;
  raw?: boolean;
} {
  return {
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  };
}
