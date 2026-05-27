import type { AgentDeviceClient } from '../client-types.ts';
import { defineCommand } from './command-contract.ts';
import {
  fieldsInputSchema,
  readFieldInput,
  type CommandFieldMap,
  type InferCommandInput,
} from './command-input.ts';

export function defineFieldCommand<
  const TName extends string,
  const TFields extends CommandFieldMap,
  TResult,
>(
  name: TName,
  description: string,
  fields: TFields,
  run: (client: AgentDeviceClient, input: InferCommandInput<TFields>) => Promise<TResult>,
) {
  return defineCommand({
    name,
    description,
    inputSchema: fieldsInputSchema(fields),
    readInput: (input) => readFieldInput(input, fields),
    run,
  });
}
