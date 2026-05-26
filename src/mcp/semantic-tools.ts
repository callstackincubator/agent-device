import { createAgentDeviceClient } from '../client.ts';
import {
  isSemanticCommandName,
  listSemanticCommandDefinitions,
  runSemanticCommand,
} from '../commands/semantic-definitions.ts';
import type { JsonSchema } from '../commands/semantic-contract.ts';

type ToolResult = {
  isError: boolean;
  structuredContent?: unknown;
  content: Array<{ type: 'text'; text: string }>;
};

export function listSemanticCommandTools(): Array<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}> {
  return listSemanticCommandDefinitions().map((definition) => ({
    name: definition.name,
    description: definition.description,
    inputSchema: definition.inputSchema,
    outputSchema: definition.outputSchema,
  }));
}

export async function callSemanticCommandTool(name: string, input: unknown): Promise<ToolResult> {
  if (!isSemanticCommandName(name)) {
    throw new Error(`Unknown semantic tool: ${name}`);
  }
  const client = createAgentDeviceClient(readClientConfig(input));
  const result = await runSemanticCommand(client, name, input);
  return {
    isError: false,
    structuredContent: result,
    content: [{ type: 'text', text: renderToolText(result) }],
  };
}

function readClientConfig(input: unknown): Parameters<typeof createAgentDeviceClient>[0] {
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
