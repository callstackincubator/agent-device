import assert from 'node:assert/strict';
import type { DaemonRequest } from '../../../src/daemon/types.ts';
import type { DeviceLabHarness, DeviceLabRpcResult } from './harness.ts';

export type DeviceLabScenarioState = {
  readonly responses: ReadonlyMap<string, DeviceLabRpcResult>;
  readonly steps: readonly DeviceLabScenarioResult[];
  response(name: string): DeviceLabRpcResult;
};

export type DeviceLabScenarioResult = {
  name: string;
  command: string;
  response: DeviceLabRpcResult;
};

export type DeviceLabScenarioStep = {
  name: string;
  command: string;
  positionals?: string[];
  flags?: DaemonRequest['flags'];
  expectStatus?: number;
  expectData?: Record<string, unknown>;
  assert?: (response: DeviceLabRpcResult, state: DeviceLabScenarioState) => void | Promise<void>;
};

export async function runDeviceLabScenario(
  daemon: Pick<DeviceLabHarness, 'callCommand'>,
  steps: readonly DeviceLabScenarioStep[],
): Promise<DeviceLabScenarioState> {
  const responses = new Map<string, DeviceLabRpcResult>();
  const results: DeviceLabScenarioResult[] = [];

  const state: DeviceLabScenarioState = {
    get responses() {
      return new Map(responses);
    },
    get steps() {
      return [...results];
    },
    response(name) {
      const response = responses.get(name);
      assert.ok(response, `Missing Device Lab scenario response: ${name}`);
      return response;
    },
  };

  for (const step of steps) {
    const response = await daemon.callCommand(step.command, step.positionals, step.flags);
    const expectedStatus = step.expectStatus ?? 200;
    assert.equal(
      response.statusCode,
      expectedStatus,
      `${step.name} expected status ${expectedStatus}: ${JSON.stringify(response.json)}`,
    );
    if (step.expectData) {
      assertDataContains(step.name, response, step.expectData);
    }
    responses.set(step.name, response);
    results.push({ name: step.name, command: step.command, response });
    await step.assert?.(response, state);
  }

  return state;
}

export function assertScenarioCommands(
  scenario: DeviceLabScenarioState,
  expectedCommands: readonly string[],
): void {
  assert.deepEqual(
    scenario.steps.map((step) => step.command),
    expectedCommands,
  );
}

function assertDataContains(
  name: string,
  response: DeviceLabRpcResult,
  expected: Record<string, unknown>,
): void {
  const data = response.json?.result?.data;
  assert.ok(data && typeof data === 'object', `${name} did not return result data`);
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(data[key], value, `${name} result data mismatch for ${key}`);
  }
}
