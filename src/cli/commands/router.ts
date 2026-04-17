import type { CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient } from '../../client.ts';
import { CLIENT_COMMANDS, type ClientCommandName } from '../../client-command-registry.ts';
import { sessionCommand } from './session.ts';
import { devicesCommand } from './devices.ts';
import { ensureSimulatorCommand } from './ensure-simulator.ts';
import { metroCommand } from './metro.ts';
import { appsCommand } from './apps.ts';
import { installCommand, reinstallCommand, installFromSourceCommand } from './install.ts';
import { runReactNativeCommand } from './run-react-native.ts';
import { openCommand, closeCommand } from './open.ts';
import { connectCommand, connectionCommand, disconnectCommand } from './connection.ts';
import { snapshotCommand } from './snapshot.ts';
import { screenshotCommand, diffCommand } from './screenshot.ts';
import { clientCommandMethodHandlers } from './client-command.ts';
import { genericClientCommandHandlers } from './generic.ts';

export type ClientCommandParams = {
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
};

export type ClientCommandHandler = (params: ClientCommandParams) => Promise<boolean>;
export type ClientCommandHandlerMap = Partial<Record<string, ClientCommandHandler>>;

const dedicatedClientApiHandlers = {
  session: sessionCommand,
  [CLIENT_COMMANDS.devices]: devicesCommand,
  [CLIENT_COMMANDS.apps]: appsCommand,
  'ensure-simulator': ensureSimulatorCommand,
  metro: metroCommand,
  install: installCommand,
  reinstall: reinstallCommand,
  'install-from-source': installFromSourceCommand,
  'run-react-native': runReactNativeCommand,
  connect: connectCommand,
  disconnect: disconnectCommand,
  connection: connectionCommand,
  open: openCommand,
  close: closeCommand,
  [CLIENT_COMMANDS.snapshot]: snapshotCommand,
  [CLIENT_COMMANDS.screenshot]: screenshotCommand,
  [CLIENT_COMMANDS.diff]: diffCommand,
} satisfies ClientCommandHandlerMap;

const clientCommandHandlers: ClientCommandHandlerMap &
  Record<ClientCommandName, ClientCommandHandler> = {
  ...dedicatedClientApiHandlers,
  ...clientCommandMethodHandlers,
  ...genericClientCommandHandlers,
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
