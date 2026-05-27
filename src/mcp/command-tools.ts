import { createAgentDeviceClient } from '../client.ts';
import type { AgentDeviceClient, AgentDeviceClientConfig } from '../client-types.ts';
import {
  isCommandName,
  listMcpToolDefinitions,
  runCommand,
  type CommandName,
} from '../commands/command-surface.ts';
import type { JsonSchema } from '../commands/command-contract.ts';

export type ToolResult = {
  isError: boolean;
  structuredContent?: unknown;
  content: Array<{ type: 'text'; text: string }>;
};

type CommandToolExecutorDeps = {
  createClient: (config: AgentDeviceClientConfig) => AgentDeviceClient;
  runCommand: (client: AgentDeviceClient, name: CommandName, input: unknown) => Promise<unknown>;
};

export type CommandToolExecutor = {
  execute: (name: string, input: unknown) => Promise<ToolResult>;
};

export function listCommandTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
}> {
  return listMcpToolDefinitions().map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
  }));
}

export function createCommandToolExecutor(
  deps: CommandToolExecutorDeps = {
    createClient: createAgentDeviceClient,
    runCommand: runCommand,
  },
): CommandToolExecutor {
  return {
    execute: async (name, input) => {
      if (!isCommandName(name)) {
        throw new Error(`Unknown command tool: ${name}`);
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

export const commandToolExecutor = createCommandToolExecutor();

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
