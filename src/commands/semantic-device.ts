import type { DeviceBootOptions } from '../client-types.ts';
import { defineSemanticCommand } from './semantic-contract.ts';
import {
  commandInputSchema,
  commandResultSchema,
  commonToClientOptions,
  optionalBoolean,
  readCommonInput,
  readInputRecord,
  type CommonCommandInput,
} from './semantic-common.ts';

type BootInput = CommonCommandInput & {
  headless?: boolean;
};

export const bootSemanticCommand = defineSemanticCommand({
  name: 'boot',
  description: 'Boot or prepare a selected device without using CLI positional arguments.',
  inputSchema: commandInputSchema({
    headless: {
      type: 'boolean',
      description: 'Boot without showing simulator UI when supported.',
    },
  }),
  outputSchema: commandResultSchema(),
  readInput: readBootInput,
  run: (client, input) => client.devices.boot(toBootOptions(input)),
});

function readBootInput(input: unknown): BootInput {
  const record = readInputRecord(input);
  return {
    ...readCommonInput(record),
    headless: optionalBoolean(record, 'headless'),
  };
}

function toBootOptions(input: BootInput): DeviceBootOptions {
  return { ...commonToClientOptions(input), headless: input.headless };
}
