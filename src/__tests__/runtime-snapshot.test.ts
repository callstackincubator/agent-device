import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceBackend, BackendSnapshotResult } from '../backend.ts';
import { createLocalArtifactAdapter } from '../io.ts';
import { createAgentDevice, localCommandPolicy, type CommandSessionStore } from '../runtime.ts';
import { makeSnapshotState } from './test-utils/index.ts';

test('runtime snapshot captures nodes and updates the session baseline', async () => {
  let stored: Parameters<CommandSessionStore['set']>[0] | undefined;
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      snapshot: makeSnapshotState([{ index: 0, depth: 0, type: 'Window', label: 'Home' }], {
        backend: 'xctest',
      }),
      appName: 'Demo',
      appBundleId: 'com.example.demo',
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => undefined,
      set: (record) => {
        stored = record;
      },
    },
    policy: localCommandPolicy(),
  });

  const result = await device.capture.snapshot({ session: 'default' });

  assert.equal(result.nodes[0]?.label, 'Home');
  assert.equal(result.truncated, false);
  assert.equal(result.appName, 'Demo');
  assert.equal(result.appBundleId, 'com.example.demo');
  assert.equal(stored?.snapshot?.nodes[0]?.label, 'Home');
});

test('runtime diff snapshot initializes and then compares against session baseline', async () => {
  const session = {
    name: 'default',
    snapshot: makeSnapshotState([{ index: 0, depth: 0, type: 'Window', label: 'Before' }]),
  };
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      snapshot: makeSnapshotState([{ index: 0, depth: 0, type: 'Window', label: 'After' }]),
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => session,
      set: (record) => {
        session.snapshot = record.snapshot!;
      },
    },
    policy: localCommandPolicy(),
  });

  const result = await device.capture.diffSnapshot({ session: 'default' });

  assert.equal(result.baselineInitialized, false);
  assert.equal(result.summary.additions, 1);
  assert.equal(result.summary.removals, 1);
  assert.equal(session.snapshot.nodes[0]?.label, 'After');
});

test('runtime diff snapshot initializes baseline when no previous snapshot exists', async () => {
  let stored: Parameters<CommandSessionStore['set']>[0] | undefined;
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      snapshot: makeSnapshotState([{ index: 0, depth: 0, type: 'Window', label: 'Initial' }]),
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => undefined,
      set: (record) => {
        stored = record;
      },
    },
    policy: localCommandPolicy(),
  });

  const result = await device.capture.diffSnapshot({ session: 'default' });

  assert.equal(result.baselineInitialized, true);
  assert.deepEqual(result.summary, { additions: 0, removals: 0, unchanged: 1 });
  assert.deepEqual(result.lines, []);
  assert.equal(stored?.snapshot?.nodes[0]?.label, 'Initial');
});

test('runtime snapshot emits filtered Android guidance from backend analysis', async () => {
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      nodes: [],
      truncated: false,
      backend: 'android',
      analysis: {
        rawNodeCount: 42,
        maxDepth: 6,
      },
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => undefined,
      set: () => {},
    },
    policy: localCommandPolicy(),
  });

  const result = await device.capture.snapshot({
    session: 'default',
    interactiveOnly: true,
    depth: 3,
  });

  assert.deepEqual(result.warnings, [
    'Interactive snapshot is empty after filtering 42 raw Android nodes. Likely causes: depth too low, transient route change, or collector filtering.',
    'Interactive output is empty at depth 3; retry without -d.',
  ]);
});

test('runtime snapshot stale-drop warning uses the runtime clock', async () => {
  const session = {
    name: 'default',
    snapshot: makeSnapshotState(
      Array.from({ length: 20 }, (_, index) => ({
        index,
        depth: 0,
        type: 'Text',
        label: `Before ${index}`,
      })),
      { backend: 'android' },
    ),
  };
  session.snapshot.createdAt = 1_000;
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      nodes: [{ ref: 'e1', index: 0, depth: 0, type: 'Text', label: 'After' }],
      truncated: false,
      backend: 'android',
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => session,
      set: (record) => {
        session.snapshot = record.snapshot!;
      },
    },
    policy: localCommandPolicy(),
    clock: {
      now: () => 1_500,
      sleep: async () => {},
    },
  });

  const result = await device.capture.snapshot({ session: 'default' });

  assert.deepEqual(result.warnings, [
    'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.',
  ]);
});

test('runtime snapshot stale-drop warning uses backend snapshot timestamps when supplied', async () => {
  const session = {
    name: 'default',
    snapshot: makeSnapshotState(
      Array.from({ length: 20 }, (_, index) => ({
        index,
        depth: 0,
        type: 'Text',
        label: `Before ${index}`,
      })),
      { backend: 'android' },
    ),
  };
  session.snapshot.createdAt = 10_000;
  const currentSnapshot = makeSnapshotState(
    [{ index: 0, depth: 0, type: 'Text', label: 'After' }],
    {
      backend: 'android',
    },
  );
  currentSnapshot.createdAt = 11_500;
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      snapshot: currentSnapshot,
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => session,
      set: (record) => {
        session.snapshot = record.snapshot!;
      },
    },
    policy: localCommandPolicy(),
    clock: {
      now: () => 1_000_000,
      sleep: async () => {},
    },
  });

  const result = await device.capture.snapshot({ session: 'default' });

  assert.deepEqual(result.warnings, [
    'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.',
  ]);
});

test('runtime snapshot stale-drop warning falls back to runtime clock on backend clock skew', async () => {
  const session = {
    name: 'default',
    snapshot: makeSnapshotState(
      Array.from({ length: 20 }, (_, index) => ({
        index,
        depth: 0,
        type: 'Text',
        label: `Before ${index}`,
      })),
      { backend: 'android' },
    ),
  };
  session.snapshot.createdAt = 10_000;
  const currentSnapshot = makeSnapshotState(
    [{ index: 0, depth: 0, type: 'Text', label: 'After' }],
    {
      backend: 'android',
    },
  );
  currentSnapshot.createdAt = 8_500;
  const device = createAgentDevice({
    backend: createSnapshotBackend(() => ({
      snapshot: currentSnapshot,
    })),
    artifacts: createLocalArtifactAdapter(),
    sessions: {
      get: () => session,
      set: (record) => {
        session.snapshot = record.snapshot!;
      },
    },
    policy: localCommandPolicy(),
    clock: {
      now: () => 11_500,
      sleep: async () => {},
    },
  });

  const result = await device.capture.snapshot({ session: 'default' });

  assert.deepEqual(result.warnings, [
    'Recent snapshots dropped sharply in node count, which suggests stale or mid-transition UI. Use screenshot as visual truth, wait briefly, then re-snapshot once.',
  ]);
});

function createSnapshotBackend(
  captureSnapshot: () => BackendSnapshotResult | Promise<BackendSnapshotResult>,
): AgentDeviceBackend {
  return {
    platform: 'ios',
    captureSnapshot: async () => await captureSnapshot(),
  };
}
