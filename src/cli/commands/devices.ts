import { printJson } from '../../utils/output.ts';
import { serializeDevice } from '../../cli-serializers.ts';
import type { AgentDeviceDevice } from '../../client.ts';
import { buildSelectionOptions } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const devicesCommand: ClientCommandHandler = async ({ flags, client }) => {
  const devices = await client.devices.list(buildSelectionOptions(flags));
  const data = { devices: devices.map(serializeDevice) };
  if (flags.json) printJson({ success: true, data });
  else process.stdout.write(`${devices.map(formatDeviceLine).join('\n')}\n`);
  return true;
};

function formatDeviceLine(device: AgentDeviceDevice): string {
  const kind = device.kind ? ` ${device.kind}` : '';
  const target = device.target ? ` target=${device.target}` : '';
  const booted = typeof device.booted === 'boolean' ? ` booted=${device.booted}` : '';
  return `${device.name} (${device.platform}${kind}${target})${booted}`;
}
