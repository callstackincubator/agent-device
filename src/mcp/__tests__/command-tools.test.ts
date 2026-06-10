import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceClient } from '../../client-types.ts';
import { createCommandToolExecutor, listCommandTools } from '../command-tools.ts';

test('MCP command tool executor hides client creation behind an execution adapter', async () => {
  const client = {} as AgentDeviceClient;
  const createdConfigs: unknown[] = [];
  const calls: unknown[] = [];
  const executor = createCommandToolExecutor({
    createClient: (config) => {
      createdConfigs.push(config);
      return client;
    },
    runCommand: async (actualClient, name, input) => {
      calls.push({ client: actualClient, name, input });
      return { message: `Ran ${name}`, ok: true };
    },
  });

  const result = await executor.execute('wait', {
    stateDir: '/tmp/agent-device-mcp',
    mcpOutputFormat: 'optimized',
  });

  assert.deepEqual(createdConfigs, [{ stateDir: '/tmp/agent-device-mcp' }]);
  assert.deepEqual(calls, [
    {
      client,
      name: 'wait',
      input: {},
    },
  ]);
  assert.deepEqual(result.structuredContent, { message: 'Ran wait', ok: true });
  assert.equal(result.content[0]?.text, 'Ran wait');
});

test('MCP command tool executor renders optimized snapshot text by default', async () => {
  const executor = createCommandToolExecutor({
    createClient: () => ({}) as AgentDeviceClient,
    runCommand: async () => ({
      nodes: [
        {
          ref: 'e1',
          index: 0,
          depth: 0,
          type: 'Button',
          label: 'Continue',
          enabled: true,
        },
      ],
      truncated: false,
    }),
  });

  const result = await executor.execute('snapshot', {});

  assert.match(result.content[0]?.text ?? '', /@e1 \[button\] "Continue"/);
  assert.doesNotMatch(result.content[0]?.text ?? '', /^\{/);
});

test('MCP command tool executor renders JSON text when requested', async () => {
  const executor = createCommandToolExecutor({
    createClient: () => ({}) as AgentDeviceClient,
    runCommand: async (_client, _name, input) => {
      assert.deepEqual(input, {});
      return {
        nodes: [
          {
            ref: 'e1',
            index: 0,
            depth: 0,
            type: 'Button',
            label: 'Continue',
            enabled: true,
          },
        ],
        truncated: false,
      };
    },
  });

  const result = await executor.execute('snapshot', { mcpOutputFormat: 'json' });

  assert.match(result.content[0]?.text ?? '', /^\{\n  "nodes": \[/);
  assert.match(result.content[0]?.text ?? '', /"label": "Continue"/);
});

test('MCP tool schemas add MCP client config fields at the MCP boundary', () => {
  const devicesTool = listCommandTools().find((tool) => tool.name === 'devices');

  assert.ok(devicesTool);
  assert.ok('stateDir' in (devicesTool.inputSchema.properties ?? {}));
  assert.deepEqual(
    (devicesTool.inputSchema.properties?.mcpOutputFormat as { enum?: unknown[] } | undefined)?.enum,
    ['optimized', 'json'],
  );
});
