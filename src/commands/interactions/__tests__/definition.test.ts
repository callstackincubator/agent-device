import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getCommandCapability } from '../../../core/capabilities.ts';
import { getCommandSchema } from '../../../utils/command-schema.ts';
import { INTERACTION_COMMAND_DEFINITIONS } from '../definition.ts';

test('interaction command definitions feed schema and capability registries', () => {
  for (const definition of INTERACTION_COMMAND_DEFINITIONS) {
    assert.deepEqual(getCommandSchema(definition.name), definition.schema);
    assert.deepEqual(getCommandCapability(definition.name), definition.capability);
  }
});
