import type { AgentDeviceClient } from '../client-types.ts';

export type JsonSchema = {
  type?: string | readonly string[];
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  prefixItems?: readonly JsonSchema[];
  oneOf?: readonly JsonSchema[];
  enum?: readonly unknown[];
  const?: unknown;
  minimum?: number;
  maximum?: number;
};

type SemanticCommandContract<Name extends string, Input, Result> = {
  name: Name;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  readInput: (input: unknown) => Input;
  run: (client: AgentDeviceClient, input: Input) => Promise<Result>;
  formatCliOutput?: SemanticCliOutputFormatter<Input, Result>;
};

export type SemanticCommandDefinition<Name extends string, Input, Result> = SemanticCommandContract<
  Name,
  Input,
  Result
> & {
  invoke: (client: AgentDeviceClient, input: unknown) => Promise<Result>;
};

export type SemanticCliOutput = {
  data: unknown;
  jsonData?: unknown;
  text?: string | null;
  stderr?: string | null;
};

export type SemanticCliOutputFormatter<Input, Result> = (params: {
  input: Input;
  result: Result;
  positionals: string[];
}) => SemanticCliOutput;

export function defineSemanticCommand<Name extends string, Input, Result>(
  definition: SemanticCommandContract<Name, Input, Result>,
): SemanticCommandDefinition<Name, Input, Result> {
  return {
    ...definition,
    invoke: async (client, input) => await definition.run(client, definition.readInput(input)),
  };
}
