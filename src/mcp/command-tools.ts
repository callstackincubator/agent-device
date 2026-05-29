import type { AgentDeviceClient, AgentDeviceClientConfig } from '../client-types.ts';
import type { JsonSchema } from '../commands/command-contract.ts';
import {
  isCommandName,
  listMcpCommandMetadata,
  type CommandName,
} from '../commands/command-metadata.ts';

type ToolResult = {
  isError: boolean;
  structuredContent?: unknown;
  content: Array<{ type: 'text'; text: string }>;
};

type CommandToolExecutorDeps = {
  createClient?: (
    config: AgentDeviceClientConfig,
  ) => AgentDeviceClient | Promise<AgentDeviceClient>;
  runCommand?: (client: AgentDeviceClient, name: CommandName, input: unknown) => Promise<unknown>;
};

type CommandToolExecutor = {
  execute: (name: string, input: unknown) => Promise<ToolResult>;
};

export function listCommandTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return listMcpCommandMetadata().map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: withMcpConfigSchema(definition.inputSchema),
  }));
}

export function createCommandToolExecutor(deps: CommandToolExecutorDeps = {}): CommandToolExecutor {
  return {
    execute: async (name, input) => {
      if (!isCommandName(name)) {
        throw new Error(`Unknown command tool: ${name}`);
      }
      const client = await createClient(deps, readClientConfig(input));
      const result = await (deps.runCommand ?? runCommand)(
        client,
        name,
        stripClientConfigFields(input),
      );
      return {
        isError: false,
        structuredContent: result,
        content: [{ type: 'text', text: renderToolText(result) }],
      };
    },
  };
}

export const commandToolExecutor = createCommandToolExecutor();

async function createClient(
  deps: CommandToolExecutorDeps,
  config: AgentDeviceClientConfig,
): Promise<AgentDeviceClient> {
  if (deps.createClient) return await deps.createClient(config);
  const { createAgentDeviceClient } = await import('../client.ts');
  return createAgentDeviceClient(config);
}

async function runCommand(
  client: AgentDeviceClient,
  name: CommandName,
  input: unknown,
): Promise<unknown> {
  const commandSurface = await import('../commands/command-surface.ts');
  return await commandSurface.runCommand(client, name, input);
}

function readClientConfig(input: unknown): AgentDeviceClientConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const stateDir = (input as Record<string, unknown>).stateDir;
  if (stateDir === undefined) return {};
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    throw new Error('Expected stateDir to be a non-empty string.');
  }
  return { stateDir };
}

function stripClientConfigFields(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const { stateDir: _stateDir, ...commandInput } = input as Record<string, unknown>;
  return commandInput;
}

function withMcpConfigSchema(schema: JsonSchema): JsonSchema {
  return {
    ...schema,
    properties: {
      ...schema.properties,
      stateDir: { type: 'string', description: 'Agent-device state directory.' },
    },
  };
}

function renderToolText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
