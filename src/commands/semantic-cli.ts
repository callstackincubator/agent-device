import type { AgentDeviceClient, CommandRequestResult } from '../client.ts';
import { readSemanticInputFromCli } from './semantic-grammar.ts';
import { runSemanticCommand, type SemanticCliCommand } from './semantic-command-surface.ts';
import type { CliFlags } from '../utils/command-schema.ts';

type SemanticCliRunOptions = {
  client: AgentDeviceClient;
  command: SemanticCliCommand;
  positionals: string[];
  flags: CliFlags;
};

export async function runSemanticCliCommand(
  options: SemanticCliRunOptions,
): Promise<CommandRequestResult> {
  const input = readSemanticInputFromCli(options.command, options.positionals, options.flags);
  return (await runSemanticCommand(options.client, options.command, input)) as CommandRequestResult;
}
