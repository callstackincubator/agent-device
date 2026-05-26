import type { AgentDeviceClient } from '../client-types.ts';
import { createBatchSemanticCommand } from './semantic-batch.ts';
import { semanticClientCommands } from './semantic-client-commands.ts';
import type { JsonSchema } from './semantic-contract.ts';
import { bootSemanticCommand } from './semantic-device.ts';
import { interactionSemanticCommands } from './semantic-interactions.ts';
import { semanticBatchCommandNames, type SemanticBatchCommand } from './semantic-grammar.ts';

type AnySemanticCommandDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  invoke: (client: AgentDeviceClient, input: unknown) => Promise<unknown>;
};

const batchSemanticCommand = createBatchSemanticCommand(semanticBatchCommandNames);

const semanticCommandSurface = [
  bootSemanticCommand,
  ...interactionSemanticCommands,
  ...semanticClientCommands,
  batchSemanticCommand,
] as const;

export type SemanticCommandName = (typeof semanticCommandSurface)[number]['name'];
export type SemanticCliCommand = SemanticCommandName;
export type { SemanticBatchCommand };

const semanticCommandMap = new Map(
  semanticCommandSurface.map((definition) => [definition.name, definition]),
);

export function listSemanticMcpToolDefinitions(): AnySemanticCommandDefinition[] {
  return [...semanticCommandSurface];
}

export function listSemanticCommandNames(): SemanticCommandName[] {
  return semanticCommandSurface.map((definition) => definition.name);
}

export function isSemanticCommandName(name: string): name is SemanticCommandName {
  return semanticCommandMap.has(name);
}

export async function runSemanticCommand(
  client: AgentDeviceClient,
  name: SemanticCommandName,
  input: unknown,
): Promise<unknown> {
  const definition = semanticCommandMap.get(name);
  if (!definition) {
    throw new Error(`Unknown semantic command: ${name}`);
  }
  return await definition.invoke(client, input);
}
