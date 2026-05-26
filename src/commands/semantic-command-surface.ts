import type { AgentDeviceClient } from '../client-types.ts';
import { createBatchSemanticCommand } from './semantic-batch.ts';
import { semanticClientCommands } from './semantic-client-commands.ts';
import type { JsonSchema, SemanticCliOutput } from './semantic-contract.ts';
import { bootSemanticCommand } from './semantic-device.ts';
import { interactionSemanticCommands } from './semantic-interactions.ts';
import { semanticBatchCommandNames, type SemanticBatchCommand } from './semantic-grammar.ts';

type AnySemanticCommandDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  invoke: (client: AgentDeviceClient, input: unknown) => Promise<unknown>;
  formatCliOutput?: (params: {
    input: never;
    result: never;
    positionals: string[];
  }) => SemanticCliOutput;
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

const semanticCommandMap: ReadonlyMap<string, AnySemanticCommandDefinition> = new Map(
  semanticCommandSurface.map((definition) => [definition.name, definition]),
);

export function listSemanticMcpToolDefinitions(): AnySemanticCommandDefinition[] {
  return [...semanticCommandSurface];
}

export function listSemanticCommandNames(): SemanticCommandName[] {
  return semanticCommandSurface.map((definition) => definition.name);
}

export function listSemanticCliOutputCommandNames(): SemanticCommandName[] {
  return semanticCommandSurface
    .filter((definition) => definition.formatCliOutput)
    .map((definition) => definition.name);
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

export function formatSemanticCliOutput(params: {
  name: SemanticCommandName;
  input: unknown;
  result: unknown;
  positionals: string[];
}): SemanticCliOutput | undefined {
  const definition = semanticCommandMap.get(params.name);
  return definition?.formatCliOutput?.({
    input: params.input as never,
    result: params.result as never,
    positionals: params.positionals,
  });
}
