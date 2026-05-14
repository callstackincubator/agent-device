import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceClient } from '../../../client.ts';
import { getCommandCapability } from '../../../core/capabilities.ts';
import { getCommandSchema, type CliFlags } from '../../../utils/command-schema.ts';
import { CAPTURE_COMMAND_DEFINITIONS } from '../../capture-definition.ts';
import { SELECTOR_COMMAND_DEFINITIONS } from '../../selectors-definition.ts';
import { SESSION_LIFECYCLE_COMMAND_DEFINITIONS } from '../../session-lifecycle/definition.ts';
import { runTypeCliCommand } from '../cli.ts';
import { INTERACTION_COMMAND_DEFINITIONS, typeCommandDefinition } from '../definition.ts';

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

test('type command definition exposes its positional codec', () => {
  assert.deepEqual(typeCommandDefinition.codec.decode(['hello', 'world'], { delayMs: 25 }), {
    text: 'hello world',
    delayMs: 25,
  });
  assert.deepEqual(typeCommandDefinition.codec.encode({ text: 'hello world' }), ['hello world']);
});

test('type CLI command routes through the definition codec', async () => {
  let received: unknown;
  const client = {
    interactions: {
      type: async (options: unknown) => {
        received = options;
        return {};
      },
    },
  } as AgentDeviceClient;

  await runTypeCliCommand({
    client,
    positionals: ['hello', 'world'],
    flags: { platform: 'ios', delayMs: 25 } as CliFlags,
  });

  const options = received as Record<string, unknown>;
  assert.equal(options.platform, 'ios');
  assert.equal(options.text, 'hello world');
  assert.equal(options.delayMs, 25);
});
