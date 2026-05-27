import type { AgentDeviceClient, CommandRequestResult } from '../client.ts';
import { formatCliOutput } from './cli-output.ts';
import { readInputFromCli } from './cli-grammar.ts';
import { runCommand, type CliCommand } from './command-surface.ts';
import type { CliOutput } from './command-contract.ts';
import type { CliFlags } from '../utils/command-schema.ts';

type CliRunOptions = {
  client: AgentDeviceClient;
  command: CliCommand;
  positionals: string[];
  flags: CliFlags;
};

export async function runCliCommand(options: CliRunOptions): Promise<CommandRequestResult> {
  return (await runCliCommandWithOutput(options)).result;
}

export async function runCliCommandWithOutput(options: CliRunOptions): Promise<{
  result: CommandRequestResult;
  cliOutput?: CliOutput;
}> {
  const input = readInputFromCli(options.command, options.positionals, options.flags);
  const result = (await runCommand(options.client, options.command, input)) as CommandRequestResult;
  return {
    result,
    cliOutput: formatCliOutput({
      name: options.command,
      input,
      result,
    }),
  };
}
