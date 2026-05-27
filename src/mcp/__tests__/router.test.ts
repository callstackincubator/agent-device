import assert from 'node:assert/strict';
import { test } from 'vitest';
import { listMcpExposedCommandNames } from '../../command-catalog.ts';
import { handleMcpMessage } from '../router.ts';

test('MCP exposes every automatable CLI command as a structured direct tool', async () => {
  const response = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });

  assert.ok(response && 'result' in response);
  const tools = (response.result as { tools: Array<{ name: string }> }).tools.map(
    (tool) => tool.name,
  );
  const expectedToolNames = listMcpExposedCommandNames().sort();

  assert.deepEqual(tools.sort(), expectedToolNames);

  const fillTool = (response.result as { tools: Array<Record<string, unknown>> }).tools.find(
    (tool) => tool.name === 'fill',
  );
  assert.ok(fillTool);
  const fillProperties = (fillTool.inputSchema as { properties: Record<string, unknown> })
    .properties;
  assert.ok(!('positionals' in fillProperties));
  assert.ok('target' in fillProperties);

  const batchTool = (response.result as { tools: Array<Record<string, unknown>> }).tools.find(
    (tool) => tool.name === 'batch',
  );
  assert.ok(batchTool);
  assert.ok(!JSON.stringify(batchTool.inputSchema).includes('"positionals"'));
  assert.ok(!JSON.stringify(batchTool.inputSchema).includes('"flags"'));

  const invalidFillResponse = await handleMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: 'fill', arguments: {} },
  });
  assert.ok(invalidFillResponse && 'result' in invalidFillResponse);
  assert.equal((invalidFillResponse.result as { isError: boolean }).isError, true);
  assert.match(JSON.stringify(invalidFillResponse.result), /Expected target to be set/);
});
