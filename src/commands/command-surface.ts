import type { AgentDeviceClient } from '../client-types.ts';
import { createBatchCommand } from './batch-command.ts';
import { clientCommandDefinitions } from './client-command-contracts.ts';
import type { JsonSchema } from './command-contract.ts';
import { interactionCommandDefinitions } from './interaction-command-contracts.ts';
import { batchCommandNames, type BatchCommandName } from './command-projection.ts';
import type { CommandName } from './command-metadata.ts';

type AnyExecutableCommand = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  invoke: (client: AgentDeviceClient, input: unknown) => Promise<unknown>;
};

const batchCommandDefinition = createBatchCommand(batchCommandNames);

const commandSurface = [
  ...interactionCommandDefinitions,
  ...clientCommandDefinitions,
  batchCommandDefinition,
] as const;

export type { BatchCommandName, CommandName };

const commandMap: ReadonlyMap<CommandName, AnyExecutableCommand> = new Map(
  commandSurface.map((definition) => [definition.name, definition]),
);

export async function runCommand(
  client: AgentDeviceClient,
  name: CommandName,
  input: unknown,
): Promise<unknown> {
  return await getCommandDefinition(name).invoke(client, input);
}

export function listExecutableCommandNames(): CommandName[] {
  return [...commandMap.keys()].sort();
}

function getCommandDefinition(name: CommandName): AnyExecutableCommand {
  return commandMap.get(name)!;
}
