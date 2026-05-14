import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { buildSelectionOptions } from '../../cli/commands/shared.ts';
import { typeCommandCodec } from './definition.ts';

export type InteractionCliCommandParams = {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
};

export async function runTypeCliCommand({
  client,
  positionals,
  flags,
}: InteractionCliCommandParams): Promise<CommandRequestResult> {
  const decoded = typeCommandCodec.decode(positionals, flags);
  return await client.interactions.type({
    ...buildSelectionOptions(flags),
    ...decoded,
  });
}
