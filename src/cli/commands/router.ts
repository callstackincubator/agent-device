import type { CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient } from '../../client.ts';
import { sessionCommand } from './session.ts';
import { devicesCommand } from './devices.ts';
import { ensureSimulatorCommand } from './ensure-simulator.ts';
import { metroCommand } from './metro.ts';
import { installCommand, reinstallCommand, installFromSourceCommand } from './install.ts';
import { openCommand, closeCommand } from './open.ts';
import { snapshotCommand } from './snapshot.ts';
import { screenshotCommand, diffCommand } from './screenshot.ts';

export type ClientCommandParams = {
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
};

export type ClientCommandHandler = (params: ClientCommandParams) => Promise<boolean>;

const clientCommandHandlers: Partial<Record<string, ClientCommandHandler>> = {
  session: sessionCommand,
  devices: devicesCommand,
  'ensure-simulator': ensureSimulatorCommand,
  metro: metroCommand,
  install: installCommand,
  reinstall: reinstallCommand,
  'install-from-source': installFromSourceCommand,
  open: openCommand,
  close: closeCommand,
  snapshot: snapshotCommand,
  screenshot: screenshotCommand,
  diff: diffCommand,
};

export async function tryRunClientBackedCommand(params: {
  command: string;
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
}): Promise<boolean> {
  const handler = clientCommandHandlers[params.command];
  return handler ? await handler(params) : false;
}
