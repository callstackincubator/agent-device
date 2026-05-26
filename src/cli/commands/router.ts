import { applyCommandDefaults, type CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient } from '../../client.ts';
import { connectCommand, connectionCommand, disconnectCommand } from './connection.ts';
import { authCommand } from './auth.ts';
import { screenshotCommand, diffCommand } from './screenshot.ts';
import { clientCommandMethodHandlers } from './client-command.ts';
import { dedicatedSemanticCommandHandlers, genericClientCommandHandlers } from './generic.ts';
import type { ClientCommandHandlerMap } from './router-types.ts';

export type {
  ClientCommandHandler,
  ClientCommandHandlerMap,
  ClientCommandParams,
} from './router-types.ts';

const dedicatedCliCommandHandlers = {
  connect: connectCommand,
  disconnect: disconnectCommand,
  connection: connectionCommand,
  auth: authCommand,
  screenshot: screenshotCommand,
  diff: diffCommand,
} satisfies ClientCommandHandlerMap;

const clientCommandHandlers: ClientCommandHandlerMap = {
  ...dedicatedCliCommandHandlers,
  ...dedicatedSemanticCommandHandlers,
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
