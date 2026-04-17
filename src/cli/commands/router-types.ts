import type { CliFlags } from '../../utils/command-schema.ts';
import type { AgentDeviceClient } from '../../client.ts';

export type ClientCommandParams = {
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
};

export type ClientCommandHandler = (params: ClientCommandParams) => Promise<boolean>;
export type ClientCommandHandlerMap = Partial<Record<string, ClientCommandHandler>>;
