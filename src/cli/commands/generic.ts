import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import { announceReplayTestRun } from '../../cli-test.ts';
import {
  runSemanticCliCommand,
  runSemanticCliCommandWithOutput,
} from '../../commands/semantic-cli.ts';
import {
  listSemanticCliOutputCommandNames,
  listSemanticCommandNames,
  type SemanticCliCommand,
} from '../../commands/semantic-command-surface.ts';
import type { SemanticCliOutput } from '../../commands/semantic-contract.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { writeCommandCliOutput } from './output.ts';
import { writeCommandOutput } from './shared.ts';
import type { PublicCommandName } from '../../command-catalog.ts';
import type { ClientCommandHandler } from './router-types.ts';

type GenericClientCommandRunner = (params: {
  client: AgentDeviceClient;
  positionals: string[];
  flags: CliFlags;
}) => Promise<CommandRequestResult>;

const formattedSemanticCommandHandlers = Object.fromEntries(
  listSemanticCliOutputCommandNames().map((command) => [
    command,
    createFormattedSemanticHandler(command),
  ]),
) as Partial<Record<SemanticCliCommand, ClientCommandHandler>>;

export const dedicatedSemanticCommandHandlers = formattedSemanticCommandHandlers;

const clientMethodCommandNames = commandNameSet([
  'wait',
  'alert',
  'appstate',
  'back',
  'home',
  'rotate',
  'app-switcher',
  'keyboard',
  'clipboard',
] as const satisfies readonly SemanticCliCommand[]);

const semanticGenericCommands = listSemanticCommandNames().filter(isGenericSemanticCliCommand);

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

function createFormattedSemanticHandler(command: SemanticCliCommand): ClientCommandHandler {
  return async ({ positionals, flags, client }) => {
    const { cliOutput } = await runSemanticCliCommandWithOutput({
      client,
      command,
      positionals,
      flags,
    });
    if (!cliOutput) {
      throw new Error(`Missing CLI output formatter for semantic command: ${command}`);
    }
    writeSemanticCliOutput(flags, cliOutput);
    return true;
  };
}

function writeSemanticCliOutput(flags: CliFlags, output: SemanticCliOutput): void {
  if (!flags.json && output.stderr) {
    process.stderr.write(output.stderr);
  }
  writeCommandOutput(
    flags,
    flags.json ? (output.jsonData ?? output.data) : output.data,
    () => output.text,
  );
}

function isGenericSemanticCliCommand(command: SemanticCliCommand): boolean {
  return (
    !(command in formattedSemanticCommandHandlers) &&
    !clientMethodCommandNames.has(command) &&
    command !== 'screenshot' &&
    command !== 'diff'
  );
}

function commandNameSet<const TName extends string>(names: readonly TName[]): ReadonlySet<string> {
  return new Set(names);
}
