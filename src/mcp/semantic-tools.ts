import { createAgentDeviceClient } from '../client.ts';
import type { AgentDeviceClient, AgentDeviceClientConfig } from '../client-types.ts';
import {
  isSemanticCommandName,
  listSemanticMcpToolDefinitions,
  runSemanticCommand,
  type SemanticCommandName,
} from '../commands/semantic-command-surface.ts';
import type { JsonSchema } from '../commands/semantic-contract.ts';

export type ToolResult = {
  isError: boolean;
  structuredContent?: unknown;
  content: Array<{ type: 'text'; text: string }>;
};

type SemanticCommandToolExecutorDeps = {
  createClient: (config: AgentDeviceClientConfig) => AgentDeviceClient;
  runCommand: (
    client: AgentDeviceClient,
    name: SemanticCommandName,
    input: unknown,
  ) => Promise<unknown>;
};

export type SemanticCommandToolExecutor = {
  execute: (name: string, input: unknown) => Promise<ToolResult>;
};

export function listSemanticCommandTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return listSemanticMcpToolDefinitions().map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
  }));
}

export function createSemanticCommandToolExecutor(
  deps: SemanticCommandToolExecutorDeps = {
    createClient: createAgentDeviceClient,
    runCommand: runSemanticCommand,
  },
): SemanticCommandToolExecutor {
  return {
    execute: async (name, input) => {
      if (!isSemanticCommandName(name)) {
        throw new Error(`Unknown semantic tool: ${name}`);
      }
      const client = deps.createClient(readClientConfig(input));
      const result = await deps.runCommand(client, name, input);
      return {
        isError: false,
        structuredContent: result,
        content: [{ type: 'text', text: renderToolText(result) }],
      };
    },
  };
}

export const semanticCommandToolExecutor = createSemanticCommandToolExecutor();

function readClientConfig(input: unknown): AgentDeviceClientConfig {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const stateDir = (input as Record<string, unknown>).stateDir;
  if (stateDir === undefined) return {};
  if (typeof stateDir !== 'string' || stateDir.length === 0) {
    throw new Error('Expected stateDir to be a non-empty string.');
  }
  return { stateDir };
}

function renderToolText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
