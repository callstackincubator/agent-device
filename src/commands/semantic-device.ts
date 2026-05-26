import { defineSemanticCommand } from './semantic-contract.ts';
import { bootCliOutput } from './semantic-client-output.ts';
import { booleanField, fieldsInputSchema, readFieldInput } from './semantic-common.ts';

const bootFields = {
  headless: booleanField('Boot without showing simulator UI when supported.'),
};

export const bootSemanticCommand = defineSemanticCommand({
  name: 'boot',
  description: 'Boot or prepare a selected device without using CLI positional arguments.',
  inputSchema: fieldsInputSchema(bootFields),
  readInput: (input) => readFieldInput(input, bootFields),
  run: (client, input) => client.devices.boot(input),
  formatCliOutput: ({ result }) => bootCliOutput(result),
});
