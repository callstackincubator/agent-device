import type { AgentDeviceClient, CommandRequestResult } from '../../client.ts';
import { announceReplayTestRun, renderReplayTestResponse } from '../../cli-test.ts';
import { listCliOutputCommandNames } from '../../commands/cli-output.ts';
import { runCliCommand, runCliCommandWithOutput } from '../../commands/cli-runner.ts';
import { listCommandNames, type CommandName } from '../../commands/command-surface.ts';
import type { CliOutput } from '../../commands/command-contract.ts';
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

const formattedCommandHandlers = Object.fromEntries(
  listCliOutputCommandNames().map((command) => [command, createFormattedHandler(command)]),
) as Partial<Record<CommandName, ClientCommandHandler>>;

export const dedicatedCommandHandlers = formattedCommandHandlers;

const genericCommands = listCommandNames().filter(isGenericCliCommand);

const genericClientCommandRunners = Object.fromEntries(
  genericCommands.map((command) => [
    command,
    async ({ client, positionals, flags }) => {
      if (command === 'test') {
        announceReplayTestRun({ json: flags.json });
      }
      return await runCliCommand({ client, command, positionals, flags });
    },
  ]),
) as Record<(typeof genericCommands)[number], GenericClientCommandRunner>;

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
    const exitCode = writeGenericCliOutput(command, flags, data);
    if (exitCode !== 0) {
      process.exit(exitCode);
    }
    return true;
  };
}

function writeGenericCliOutput(
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

function createFormattedHandler(command: CommandName): ClientCommandHandler {
  return async ({ positionals, flags, client }) => {
    const { cliOutput } = await runCliCommandWithOutput({
      client,
      command,
      positionals,
      flags,
    });
    if (!cliOutput) {
      throw new Error(`Missing CLI output formatter for command: ${command}`);
    }
    writeCliOutput(flags, cliOutput);
    return true;
  };
}

function writeCliOutput(flags: CliFlags, output: CliOutput): void {
  if (!flags.json && output.stderr) {
    process.stderr.write(output.stderr);
  }
  writeCommandOutput(
    flags,
    flags.json ? (output.jsonData ?? output.data) : output.data,
    () => output.text,
  );
}

function isGenericCliCommand(command: CommandName): boolean {
  return !(command in formattedCommandHandlers) && command !== 'screenshot' && command !== 'diff';
}
