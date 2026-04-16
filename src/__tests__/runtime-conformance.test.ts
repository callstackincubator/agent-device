import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceBackend } from '../backend.ts';
import { createLocalArtifactAdapter } from '../io.ts';
import { createAgentDevice, createMemorySessionStore, localCommandPolicy } from '../runtime.ts';
import {
  assertCommandConformance,
  commandConformanceSuites,
  runCommandConformance,
} from '../testing/conformance.ts';
import type { SnapshotState } from '../utils/snapshot.ts';
import { makeSnapshotState } from './test-utils/index.ts';

test('command conformance suites run against a fixture backend', async () => {
  const calls: string[] = [];
  const report = await runCommandConformance({
    name: 'fixture',
    createRuntime: () =>
      createAgentDevice({
        backend: createFixtureBackend(calls),
        artifacts: createLocalArtifactAdapter(),
        sessions: createMemorySessionStore([{ name: 'default', snapshot: fixtureSnapshot() }]),
        policy: localCommandPolicy(),
      }),
  });

  assert.equal(report.target, 'fixture');
  assert.equal(report.failed, 0);
  assert.equal(report.passed, commandConformanceSuites.flatMap((suite) => suite.cases).length);
  assert.equal(calls.includes('screenshot'), true);
  assert.equal(calls.includes('tap'), true);
  assert.equal(calls.includes('fill'), true);
  assert.equal(calls.includes('typeText'), true);
  assert.equal(calls.includes('openApp'), true);
  assert.equal(calls.includes('closeApp'), true);
  assert.equal(calls.includes('listApps'), true);
  assert.equal(calls.includes('getAppState'), true);
  assert.equal(calls.includes('pushFile'), true);
  assert.equal(calls.includes('triggerAppEvent'), true);
});

test('assertCommandConformance throws when a suite fails', async () => {
  await assert.rejects(
    () =>
      assertCommandConformance({
        name: 'missing-screenshot',
        createRuntime: () =>
          createAgentDevice({
            backend: {
              ...createFixtureBackend([]),
              captureScreenshot: undefined,
            },
            artifacts: createLocalArtifactAdapter(),
            sessions: createMemorySessionStore([{ name: 'default', snapshot: fixtureSnapshot() }]),
            policy: localCommandPolicy(),
          }),
      }),
    /failed/,
  );
});

function createFixtureBackend(calls: string[]): AgentDeviceBackend {
  return {
    platform: 'ios',
    captureScreenshot: async () => {
      calls.push('screenshot');
    },
    captureSnapshot: async () => {
      calls.push('snapshot');
      return { snapshot: fixtureSnapshot() };
    },
    tap: async () => {
      calls.push('tap');
    },
    fill: async () => {
      calls.push('fill');
    },
    typeText: async () => {
      calls.push('typeText');
    },
    openApp: async () => {
      calls.push('openApp');
    },
    closeApp: async () => {
      calls.push('closeApp');
    },
    listApps: async () => {
      calls.push('listApps');
      return [{ id: 'com.example.app', name: 'Example', bundleId: 'com.example.app' }];
    },
    getAppState: async (_context, app) => {
      calls.push('getAppState');
      return { bundleId: app, state: 'foreground' };
    },
    pushFile: async () => {
      calls.push('pushFile');
    },
    triggerAppEvent: async () => {
      calls.push('triggerAppEvent');
    },
  };
}

function fixtureSnapshot(): SnapshotState {
  return makeSnapshotState([
    {
      index: 0,
      depth: 0,
      type: 'Button',
      label: 'Continue',
      value: 'Continue',
      rect: { x: 10, y: 20, width: 100, height: 40 },
      hittable: true,
    },
    {
      index: 1,
      depth: 0,
      type: 'XCUIElementTypeTextField',
      label: 'Email',
      rect: { x: 20, y: 80, width: 180, height: 40 },
      hittable: true,
    },
  ]);
}
