import { serializeDevice } from '../../client-shared.ts';
import type { AgentDeviceDevice } from '../../client.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const devicesCommand: ClientCommandHandler = async ({ flags, client }) => {
  const devices = (await runSemanticCliCommand({
    client,
    command: 'devices',
    positionals: [],
    flags,
  })) as unknown as AgentDeviceDevice[];
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
