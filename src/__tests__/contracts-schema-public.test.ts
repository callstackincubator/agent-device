import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  daemonCommandRequestSchema,
  daemonRuntimeSchema,
  centerOfRect,
  jsonRpcRequestSchema,
  leaseAllocateSchema,
  leaseHeartbeatSchema,
  leaseReleaseSchema,
  type Rect,
  type SnapshotNode,
} from '../contracts.ts';

const rect = { x: 1, y: 2, width: 3, height: 4 } satisfies Rect;
const node = {
  index: 0,
  ref: 'e1',
  type: 'Button',
  label: 'Continue',
  rect,
} satisfies SnapshotNode;

test('public contract schemas validate daemon requests and lease payloads', () => {
  const runtime = daemonRuntimeSchema.parse({
    platform: 'ios',
    metroHost: '127.0.0.1',
    metroPort: 8081,
    bundleUrl: 'https://example.test/index.bundle?platform=ios',
  });
  const request = daemonCommandRequestSchema.parse({
    command: 'open',
    positionals: ['Demo'],
    runtime,
    meta: {
      tenantId: 'acme',
      runId: 'run-1',
      leaseBackend: 'ios-instance',
      lockPolicy: 'reject',
      lockPlatform: 'ios',
    },
  });
  const allocate = leaseAllocateSchema.parse({
    tenantId: 'acme',
    runId: 'run-1',
    ttlMs: 60_000,
    backend: 'android-instance',
  });
  const heartbeat = leaseHeartbeatSchema.parse({
    tenantId: 'acme',
    runId: 'run-1',
    leaseId: 'lease-1',
    ttlMs: 60_000,
  });
  const release = leaseReleaseSchema.parse({
    tenant: 'acme',
    runId: 'run-1',
    leaseId: 'lease-1',
  });

  assert.equal(request.runtime?.platform, 'ios');
  assert.equal(request.meta?.leaseBackend, 'ios-instance');
  assert.equal(request.session, undefined);
  assert.equal(allocate.backend, 'android-instance');
  assert.equal(heartbeat.runId, 'run-1');
  assert.equal(release.tenant, 'acme');
  assert.equal(heartbeat.leaseId, 'lease-1');
  assert.equal(release.leaseId, 'lease-1');
  assert.deepEqual(centerOfRect(rect), { x: 3, y: 4 });
  assert.equal(node.ref, 'e1');
});

test('public contract schemas reject invalid payloads', () => {
  assert.throws(
    () =>
      daemonCommandRequestSchema.parse({
        token: 'secret',
        session: 'default',
        command: 'open',
        positionals: [123],
      }),
    /positionals\[0\]/,
  );
  assert.throws(
    () =>
      jsonRpcRequestSchema.parse({
        jsonrpc: '2.0',
        id: {},
        method: 'agent_device.command',
      }),
    /\.id/,
  );
  assert.throws(
    () =>
      leaseReleaseSchema.parse({
        token: 'secret',
        leaseId: 'lease-1',
        ttlMs: 60_000,
      }),
    /\.ttlMs/,
  );
});
