import { batchSemanticCommand } from './semantic-batch.ts';
import { semanticClientCommands } from './semantic-client-commands.ts';
import { bootSemanticCommand } from './semantic-device.ts';
import { interactionSemanticCommands } from './semantic-interactions.ts';
import { semanticLocalCommands } from './semantic-local-commands.ts';
import type { AgentDeviceClient } from '../client-types.ts';

export const semanticCommandDefinitions = [
  bootSemanticCommand,
  ...interactionSemanticCommands,
  ...semanticClientCommands,
  ...semanticLocalCommands,
  batchSemanticCommand,
] as const;

export type SemanticCommandName = (typeof semanticCommandDefinitions)[number]['name'];

const semanticCommandMap = new Map(
  semanticCommandDefinitions.map((definition) => [definition.name, definition]),
);

export function listSemanticCommandDefinitions(): typeof semanticCommandDefinitions {
  return semanticCommandDefinitions;
}

export function isSemanticCommandName(name: string): name is SemanticCommandName {
  return semanticCommandMap.has(name as SemanticCommandName);
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
