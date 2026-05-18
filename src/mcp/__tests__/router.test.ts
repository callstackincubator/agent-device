import assert from 'node:assert/strict';
import { test } from 'vitest';
import { handleMcpMessage } from '../router.ts';

test('MCP initialize advertises discovery-only tool capability', () => {
  const response = handleMcpMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2099-01-01',
    },
  });

  assert.ok(response && 'result' in response);
  const result = response.result as {
    protocolVersion: string;
    capabilities: Record<string, unknown>;
  };
  assert.equal(result.protocolVersion, '2025-11-25');
  assert.deepEqual(result.capabilities, { tools: {} });
});

test('MCP tools/list exposes only status', () => {
  const response = handleMcpMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
  });

  assert.ok(response && 'result' in response);
  const tools = (
    response.result as { tools: Array<{ name: string; outputSchema?: { type: string } }> }
  ).tools;
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['status'],
  );
  assert.equal(tools[0]?.outputSchema?.type, 'object');
});

test('MCP status tool returns structured CLI handoff guidance', () => {
  const response = handleMcpMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'status',
    },
  });

  assert.ok(response && 'result' in response);
  const result = response.result as {
    content: Array<{ text: string }>;
    isError: boolean;
    structuredContent: {
      packageName: string;
      cliCommandName: string;
      installCommand: string;
      verifyCommand: string;
      startingHelpCommand: string;
      supportedTargets: string[];
      capabilities: string[];
      prerequisites: string[];
      docsUrl: string;
      agentDocsUrl: string;
      firstCommands: string[];
      automationInterface: string;
      automationNote: string;
      installRequiresHumanApproval: boolean;
      installSafetyNote: string;
    };
  };
  assert.equal(result.isError, false);

  const handoff = result.structuredContent;
  assert.deepEqual(JSON.parse(result.content[0]?.text ?? ''), handoff);
  assert.equal(handoff.packageName, 'agent-device');
  assert.equal(handoff.cliCommandName, 'agent-device');
  assert.equal(handoff.installCommand, 'npm install -g agent-device@latest');
  assert.equal(handoff.verifyCommand, 'agent-device --version');
  assert.equal(handoff.startingHelpCommand, 'agent-device help workflow');
  assert.ok(handoff.supportedTargets.includes('ios-simulator'));
  assert.ok(handoff.supportedTargets.includes('android-emulator'));
  assert.ok(handoff.capabilities.includes('inspect-ui'));
  assert.ok(handoff.capabilities.includes('interact-with-elements'));
  assert.ok(handoff.capabilities.includes('accessibility-snapshot'));
  assert.ok(handoff.capabilities.includes('react-native'));
  assert.ok(handoff.capabilities.includes('expo'));
  assert.ok(handoff.capabilities.includes('android-adb'));
  assert.ok(handoff.capabilities.includes('ios-xcuitest'));
  assert.ok(handoff.prerequisites.includes('node>=22'));
  assert.ok(handoff.prerequisites.includes('xcode-for-ios'));
  assert.ok(handoff.prerequisites.includes('android-sdk-adb-for-android'));
  assert.equal(handoff.docsUrl, 'https://agent-device.dev/');
  assert.equal(handoff.agentDocsUrl, 'https://incubator.callstack.com/agent-device/llms-full.txt');
  assert.ok(handoff.firstCommands.includes('agent-device apps --platform ios'));
  assert.ok(handoff.firstCommands.includes('agent-device apps --platform android'));
  assert.equal(handoff.automationInterface, 'cli');
  assert.match(handoff.automationNote, /discovery-only/);
  assert.equal(handoff.installRequiresHumanApproval, true);
  assert.match(handoff.installSafetyNote, /human has approved/);
});
