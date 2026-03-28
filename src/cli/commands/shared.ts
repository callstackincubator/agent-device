import type { CliFlags } from '../../utils/command-schema.ts';
import { printJson } from '../../utils/output.ts';
import { readCommandMessage } from '../../utils/success-text.ts';

export function buildSelectionOptions(flags: CliFlags): {
  platform?: CliFlags['platform'];
  target?: CliFlags['target'];
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
} {
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

export function writeCommandOutput(
  flags: CliFlags,
  data: unknown,
  renderHuman?: () => string | null | undefined,
): void {
  if (flags.json) {
    printJson({ success: true, data });
    return;
  }
  const text = renderHuman?.();
  if (text) writeLine(text);
}

export function writeCommandMessage(flags: CliFlags, data: Record<string, unknown>): void {
  writeCommandOutput(flags, data, () => readCommandMessage(data));
}

function writeLine(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}
