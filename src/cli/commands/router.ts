import { applyCommandDefaults, type CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient } from '../../client.ts';
import { sessionCommand } from './session.ts';
import { devicesCommand } from './devices.ts';
import { metroCommand } from './metro.ts';
import { appsCommand } from './apps.ts';
import { installCommand, reinstallCommand, installFromSourceCommand } from './install.ts';
import { openCommand, closeCommand } from './open.ts';
import { connectCommand, connectionCommand, disconnectCommand } from './connection.ts';
import { authCommand } from './auth.ts';
import { snapshotCommand } from './snapshot.ts';
import { screenshotCommand, diffCommand } from './screenshot.ts';
import { clientCommandMethodHandlers } from './client-command.ts';
import { genericClientCommandHandlers } from './generic.ts';
import type { ClientCommandHandlerMap } from './router-types.ts';

export type {
  ClientCommandHandler,
  ClientCommandHandlerMap,
  ClientCommandParams,
} from './router-types.ts';

const dedicatedCliCommandHandlers = {
  session: sessionCommand,
  devices: devicesCommand,
  apps: appsCommand,
  metro: metroCommand,
  install: installCommand,
  reinstall: reinstallCommand,
  'install-from-source': installFromSourceCommand,
  connect: connectCommand,
  disconnect: disconnectCommand,
  connection: connectionCommand,
  auth: authCommand,
  open: openCommand,
  close: closeCommand,
  snapshot: snapshotCommand,
  screenshot: screenshotCommand,
  diff: diffCommand,
} satisfies ClientCommandHandlerMap;

const clientCommandHandlers: ClientCommandHandlerMap = {
  ...dedicatedCliCommandHandlers,
  ...clientCommandMethodHandlers,
  ...genericClientCommandHandlers,
};

export async function tryRunClientBackedCommand(params: {
  command: string;
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
}): Promise<boolean> {
  const handler = clientCommandHandlers[params.command as keyof typeof clientCommandHandlers];
  if (!handler) return false;
  const flags = { ...params.flags };
  applyCommandDefaults(params.command, flags);
  return await handler({ ...params, flags });
}
