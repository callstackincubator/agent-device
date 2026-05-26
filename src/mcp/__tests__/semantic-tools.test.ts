import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceClient } from '../../client-types.ts';
import { createSemanticCommandToolExecutor } from '../semantic-tools.ts';

test('MCP semantic tool executor hides client creation behind an execution adapter', async () => {
  const client = {} as AgentDeviceClient;
  const createdConfigs: unknown[] = [];
  const calls: unknown[] = [];
  const executor = createSemanticCommandToolExecutor({
    createClient: (config) => {
      createdConfigs.push(config);
      return client;
    },
    runCommand: async (actualClient, name, input) => {
      calls.push({ client: actualClient, name, input });
      return { name, ok: true };
    },
  });

  const result = await executor.execute('devices', { stateDir: '/tmp/agent-device-mcp' });

  assert.deepEqual(createdConfigs, [{ stateDir: '/tmp/agent-device-mcp' }]);
  assert.deepEqual(calls, [
    {
      client,
      name: 'devices',
      input: { stateDir: '/tmp/agent-device-mcp' },
    },
  ]);
  assert.deepEqual(result.structuredContent, { name: 'devices', ok: true });
  assert.match(result.content[0]?.text ?? '', /"name": "devices"/);
});
