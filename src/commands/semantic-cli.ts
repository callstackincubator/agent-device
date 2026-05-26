import type { AgentDeviceClient, CommandRequestResult } from '../client.ts';
import { readSemanticInputFromCli } from './semantic-grammar.ts';
import {
  formatSemanticCliOutput,
  runSemanticCommand,
  type SemanticCliCommand,
} from './semantic-command-surface.ts';
import type { SemanticCliOutput } from './semantic-contract.ts';
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
  return (await runSemanticCliCommandWithOutput(options)).result;
}

export async function runSemanticCliCommandWithOutput(options: SemanticCliRunOptions): Promise<{
  result: CommandRequestResult;
  cliOutput?: SemanticCliOutput;
}> {
  const input = readSemanticInputFromCli(options.command, options.positionals, options.flags);
  const result = (await runSemanticCommand(
    options.client,
    options.command,
    input,
  )) as CommandRequestResult;
  return {
    result,
    cliOutput: formatSemanticCliOutput({
      name: options.command,
      input,
      result,
      positionals: options.positionals,
    }),
  };
}
