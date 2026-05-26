import type { AgentDeviceClient } from '../client-types.ts';
import { createBatchSemanticCommand } from './semantic-batch.ts';
import { semanticClientCommands } from './semantic-client-commands.ts';
import type { JsonSchema } from './semantic-contract.ts';
import { bootSemanticCommand } from './semantic-device.ts';
import { interactionSemanticCommands } from './semantic-interactions.ts';
import {
  isSemanticBatchCommand as isSemanticGrammarBatchCommand,
  semanticBatchCommandNames,
  type SemanticBatchCommand,
} from './semantic-grammar.ts';

type AnySemanticCommandDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  invoke: (client: AgentDeviceClient, input: unknown) => Promise<unknown>;
};

type CommandSurfaceEntry<TDefinition extends AnySemanticCommandDefinition> = {
  definition: TDefinition;
  batch: boolean;
  genericCli: boolean;
};

function commandSurfaceEntry<
  TDefinition extends AnySemanticCommandDefinition,
  const TMetadata extends Omit<CommandSurfaceEntry<TDefinition>, 'definition'>,
>(definition: TDefinition, metadata: TMetadata): { definition: TDefinition } & TMetadata {
  return { definition, ...metadata };
}

const semanticGenericCliCommandNames = [
  'boot',
  'push',
  'perf',
  'click',
  'get',
  'replay',
  'test',
  'batch',
  'press',
  'longpress',
  'swipe',
  'gesture',
  'focus',
  'type',
  'fill',
  'scroll',
  'trigger-app-event',
  'record',
  'trace',
  'logs',
  'network',
  'react-native',
  'find',
  'is',
  'settings',
] as const;

const semanticDedicatedCliCommandNames = [
  'wait',
  'alert',
  'appstate',
  'back',
  'home',
  'rotate',
  'app-switcher',
  'keyboard',
  'clipboard',
  'devices',
  'apps',
  'session',
  'open',
  'close',
  'install',
  'reinstall',
  'install-from-source',
  'snapshot',
  'screenshot',
  'diff',
  'metro',
] as const;

const semanticCliCommandNames = [
  ...semanticGenericCliCommandNames,
  ...semanticDedicatedCliCommandNames,
] as const;

const genericCliNames = commandNameSet(semanticGenericCliCommandNames);

const baseCommandSurface = [
  commandSurfaceEntry(bootSemanticCommand, commandMetadata(bootSemanticCommand.name)),
  ...interactionSemanticCommands.map((definition) =>
    commandSurfaceEntry(definition, commandMetadata(definition.name)),
  ),
  ...semanticClientCommands.map((definition) =>
    commandSurfaceEntry(definition, commandMetadata(definition.name)),
  ),
] as const;

const batchSemanticCommand = createBatchSemanticCommand(semanticBatchCommandNames);

const semanticCommandSurface = [
  ...baseCommandSurface,
  commandSurfaceEntry(batchSemanticCommand, {
    batch: false,
    genericCli: true,
  }),
] as const;

export type SemanticCommandName = (typeof semanticCommandSurface)[number]['definition']['name'];
export type SemanticCliCommand = (typeof semanticCliCommandNames)[number];
export type { SemanticBatchCommand };

const semanticCommandMap = new Map(
  semanticCommandSurface.map((entry) => [entry.definition.name, entry.definition]),
);

function commandMetadata(
  name: string,
): Omit<CommandSurfaceEntry<AnySemanticCommandDefinition>, 'definition'> {
  return {
    batch: isSemanticGrammarBatchCommand(name),
    genericCli: genericCliNames.has(name),
  };
}

export function listSemanticMcpToolDefinitions(): AnySemanticCommandDefinition[] {
  return semanticCommandSurface.map((entry) => entry.definition);
}

export function listSemanticGenericCliCommands(): SemanticCliCommand[] {
  return semanticCommandSurface
    .filter((entry) => entry.genericCli)
    .map((entry) => entry.definition.name as SemanticCliCommand);
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

function commandNameSet<const TName extends string>(names: readonly TName[]): ReadonlySet<string> {
  return new Set(names);
}
