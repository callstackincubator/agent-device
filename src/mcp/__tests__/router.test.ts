import assert from 'node:assert/strict';
import { test } from 'vitest';
import { handleMcpMessage } from '../router.ts';
import { handleMcpPayload } from '../server.ts';

test('MCP router exposes status install and help tools only', () => {
  const response = handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/list',
  });

  assert.equal(response?.jsonrpc, '2.0');
  assert.ok(response && 'result' in response);
  const tools = (response.result as { tools: Array<{ name: string }> }).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['status', 'install', 'help'],
  );
});

test('MCP help tool returns versioned workflow guidance', () => {
  const response = handleMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'help',
      arguments: { topic: 'workflow' },
    },
  });

  assert.ok(response && 'result' in response);
  const result = response.result as { content: Array<{ text: string }>; isError: boolean };
  assert.equal(result.isError, false);
  assert.match(result.content[0]?.text ?? '', /agent-device help workflow/);
  assert.match(result.content[0]?.text ?? '', /snapshot -i/);
});

test('MCP install tool can return npx client config', () => {
  const response = handleMcpMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'install',
      arguments: { global: false, client: 'Cline' },
    },
  });

  assert.ok(response && 'result' in response);
  const result = response.result as { content: Array<{ text: string }> };
  const text = result.content[0]?.text ?? '';
  assert.match(text, /npx -y agent-device mcp/);
  assert.match(text, /"args": \["-y","agent-device","mcp"\]/);
  assert.match(text, /Client hint: Cline/);
});

test('MCP exposes help resources and workflow prompts', () => {
  const resources = handleMcpMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'resources/list',
  });
  assert.ok(resources && 'result' in resources);
  const resourceUris = (resources.result as { resources: Array<{ uri: string }> }).resources.map(
    (resource) => resource.uri,
  );
  assert.ok(resourceUris.includes('agent-device://help/workflow'));
  assert.ok(resourceUris.includes('agent-device://help/react-native'));

  const prompt = handleMcpMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'prompts/get',
    params: {
      name: 'agent-device-dogfood',
      arguments: { target: 'SampleApp on iOS' },
    },
  });
  assert.ok(prompt && 'result' in prompt);
  const result = prompt.result as { messages: Array<{ content: { text: string } }> };
  assert.match(result.messages[0]?.content.text ?? '', /dogfood/);
  assert.match(result.messages[0]?.content.text ?? '', /SampleApp on iOS/);
});

test('MCP React Native prompt routes to RN workflow guidance', () => {
  const prompt = handleMcpMessage({
    jsonrpc: '2.0',
    id: 6,
    method: 'prompts/get',
    params: {
      name: 'agent-device-react-native',
    },
  });

  assert.ok(prompt && 'result' in prompt);
  const result = prompt.result as { messages: Array<{ content: { text: string } }> };
  assert.match(result.messages[0]?.content.text ?? '', /react-native/);
});

test('MCP initialize returns supported protocol version and unknown methods use JSON-RPC code', () => {
  const initialized = handleMcpMessage({
    jsonrpc: '2.0',
    id: 6,
    method: 'initialize',
    params: {
      protocolVersion: '2099-01-01',
    },
  });
  assert.ok(initialized && 'result' in initialized);
  assert.equal((initialized.result as { protocolVersion: string }).protocolVersion, '2025-11-25');

  const unknown = handleMcpMessage({
    jsonrpc: '2.0',
    id: 7,
    method: 'unknown/method',
  });
  assert.ok(unknown && 'error' in unknown);
  assert.equal(unknown.error.code, -32601);
});

test('MCP batch requests return one JSON-RPC array response', () => {
  const response = handleMcpPayload([
    {
      jsonrpc: '2.0',
      id: 8,
      method: 'ping',
    },
    {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    },
    {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/list',
    },
  ]);

  assert.ok(Array.isArray(response));
  assert.equal(response.length, 2);
  assert.equal(response[0]?.id, 8);
  assert.equal(response[1]?.id, 9);
});
