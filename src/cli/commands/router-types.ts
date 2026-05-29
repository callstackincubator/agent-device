import type { CliFlags } from '../../utils/cli-flags.ts';
import type { AgentDeviceClient } from '../../client.ts';
import type { CliCommandName } from '../../command-catalog.ts';

export type ClientCommandParams = {
  positionals: string[];
  flags: CliFlags;
  client: AgentDeviceClient;
};

export type ClientCommandHandler = (params: ClientCommandParams) => Promise<boolean>;
export type ClientCommandHandlerMap = Partial<Record<CliCommandName, ClientCommandHandler>>;
