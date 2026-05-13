import assert from 'node:assert/strict';
import { test } from 'vitest';
import { getCommandCapability } from '../../../core/capabilities.ts';
import { getCommandSchema } from '../../../utils/command-schema.ts';
import { CAPTURE_COMMAND_DEFINITIONS } from '../../capture-definition.ts';
import { SELECTOR_COMMAND_DEFINITIONS } from '../../selectors-definition.ts';
import { SESSION_LIFECYCLE_COMMAND_DEFINITIONS } from '../../session-lifecycle/definition.ts';
import { INTERACTION_COMMAND_DEFINITIONS } from '../definition.ts';

test('command definitions feed schema and capability registries', () => {
  for (const definition of [
    ...INTERACTION_COMMAND_DEFINITIONS,
    ...CAPTURE_COMMAND_DEFINITIONS,
    ...SELECTOR_COMMAND_DEFINITIONS,
    ...SESSION_LIFECYCLE_COMMAND_DEFINITIONS,
  ]) {
    assert.deepEqual(getCommandSchema(definition.name), definition.schema);
    assert.deepEqual(getCommandCapability(definition.name), definition.capability);
  }
});
