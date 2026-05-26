import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import { announceReplayTestRun, renderReplayTestResponse } from '../../cli-test.ts';
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
import type { ReplaySuiteResult } from '../../daemon/types.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { readCommandMessage } from '../../utils/success-text.ts';
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
    const exitCode = writeGenericSemanticCliOutput(command, flags, data);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return true;
  };
}

function writeGenericSemanticCliOutput(
  command: PublicCommandName,
  flags: CliFlags,
  data: CommandRequestResult,
): number {
  if (command === 'test') {
    return renderReplayTestResponse({
      suite: data as ReplaySuiteResult,
      verbose: flags.verbose,
      json: flags.json,
      reportJunit: flags.reportJunit,
    });
  }
  writeCommandOutput(flags, data, () =>
    readCommandMessage(data as Record<string, unknown> | undefined),
  );
  return 0;
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
    !(command in formattedSemanticCommandHandlers) && command !== 'screenshot' && command !== 'diff'
  );
}
