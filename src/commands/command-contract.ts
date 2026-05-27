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

type CommandContract<Name extends string, Input, Result> = {
  name: Name;
  description: string;
  inputSchema: JsonSchema;
  readInput: (input: unknown) => Input;
  run: (client: AgentDeviceClient, input: Input) => Promise<Result>;
};

export type ExecutableCommandContract<Name extends string, Input, Result> = CommandContract<
  Name,
  Input,
  Result
> & {
  invoke: (client: AgentDeviceClient, input: unknown) => Promise<Result>;
};

export type CliOutput = {
  data: unknown;
  jsonData?: unknown;
  text?: string | null;
  stderr?: string | null;
};

export function defineCommand<Name extends string, Input, Result>(
  definition: CommandContract<Name, Input, Result>,
): ExecutableCommandContract<Name, Input, Result> {
  return {
    ...definition,
    invoke: async (client, input) => await definition.run(client, definition.readInput(input)),
  };
}
