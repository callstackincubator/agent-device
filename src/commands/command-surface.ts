import type { AgentDeviceClient } from '../client-types.ts';
import { listMcpExposedCommandNames } from '../command-catalog.ts';
import { createBatchCommand } from './batch-command-contract.ts';
import { clientCommandDefinitions } from './client-command-contracts.ts';
import type { JsonSchema } from './command-contract.ts';
import { interactionCommandDefinitions } from './interaction-command-contracts.ts';
import { batchCommandNames, type BatchCommandName } from './cli-grammar.ts';

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

export type CommandName = (typeof commandSurface)[number]['name'];
export type CliCommand = CommandName;
export type { BatchCommandName };

const commandMap: ReadonlyMap<CommandName, AnyExecutableCommand> = new Map(
  commandSurface.map((definition) => [definition.name, definition]),
);

export function listMcpToolDefinitions(): AnyExecutableCommand[] {
  return listMcpExposedCommandNames().map((name) => {
    if (!isCommandName(name)) {
      throw new Error(`Missing command for MCP-exposed command: ${name}`);
    }
    return getCommandDefinition(name);
  });
}

export function listCommandNames(): CommandName[] {
  return commandSurface.map((definition) => definition.name);
}

export function listCommandDefinitions(): AnyExecutableCommand[] {
  return [...commandSurface];
}

export function isCommandName(name: string): name is CommandName {
  return commandMap.has(name as CommandName);
}

export async function runCommand(
  client: AgentDeviceClient,
  name: CommandName,
  input: unknown,
): Promise<unknown> {
  return await getCommandDefinition(name).invoke(client, input);
}

function getCommandDefinition(name: CommandName): AnyExecutableCommand {
  return commandMap.get(name)!;
}
