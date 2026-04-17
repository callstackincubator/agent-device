import { serializeDevice } from '../../client-shared.ts';
import type { AgentDeviceDevice } from '../../client.ts';
import { buildSelectionOptions, writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const devicesCommand: ClientCommandHandler = async ({ flags, client }) => {
  const devices = await client.devices.list(buildSelectionOptions(flags));
  const data = { devices: devices.map(serializeDevice) };
  writeCommandOutput(flags, data, () => devices.map(formatDeviceLine).join('\n'));
  return true;
};

function formatDeviceLine(device: AgentDeviceDevice): string {
  const kind = device.kind ? ` ${device.kind}` : '';
  const target = device.target ? ` target=${device.target}` : '';
  const booted = typeof device.booted === 'boolean' ? ` booted=${device.booted}` : '';
  return `${device.name} (${device.platform}${kind}${target})${booted}`;
}
