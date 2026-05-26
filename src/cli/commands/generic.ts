import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import { announceReplayTestRun } from '../../cli-test.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import { listSemanticGenericCliCommands } from '../../commands/semantic-command-surface.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { writeCommandCliOutput } from './output.ts';
import type { PublicCommandName } from '../../command-catalog.ts';
import type { ClientCommandHandler } from './router-types.ts';

type GenericClientCommandRunner = (params: {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
}) => Promise<CommandRequestResult>;

const semanticGenericCommands = listSemanticGenericCliCommands();

const genericClientCommandRunners = Object.fromEntries(
  semanticGenericCommands.map((command) => [
    command,
    async ({ client, positionals, flags }) => {
      if (command === 'test') {
        announceReplayTestRun({ json: flags.json });
      }
      return await runSemanticCliCommand({ client, command, positionals, flags });
    },
  ]),
) as Record<(typeof semanticGenericCommands)[number], GenericClientCommandRunner>;

export const genericClientCommandHandlers = Object.fromEntries(
  Object.entries(genericClientCommandRunners).map(([command, run]) => [
    command,
    createGenericClientCommandHandler(
      command as PublicCommandName,
      run as GenericClientCommandRunner,
    ),
  ]),
) as { [TCommand in keyof typeof genericClientCommandRunners]: ClientCommandHandler };

function createGenericClientCommandHandler(
  command: PublicCommandName,
  run: GenericClientCommandRunner,
): ClientCommandHandler {
  return async ({ positionals, flags, client }) => {
    const data = await run({ client, positionals, flags });
    const exitCode = writeCommandCliOutput(command, positionals, flags, data);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return true;
  };
}
