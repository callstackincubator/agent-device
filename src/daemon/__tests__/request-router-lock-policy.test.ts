import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequestHandler } from '../request-router.ts';
import { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import { LeaseRegistry } from '../lease-registry.ts';

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-router-lock-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeIosSession(name: string): SessionState {
  return {
    name,
    createdAt: Date.now(),
    actions: [],
    device: {
      platform: 'ios',
      target: 'mobile',
      id: 'SIM-001',
      name: 'iPhone 16',
      kind: 'simulator',
      booted: true,
      simulatorSetPath: '/tmp/tenant-a/set',
    },
  };
}

test('direct daemon requests cannot bypass reject lock policy for existing sessions', async () => {
  const sessionStore = makeStore();
  sessionStore.set('qa-ios', makeIosSession('qa-ios'));
  let dispatchCalls = 0;

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
    dispatchCommand: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  const response = await handler({
    token: 'test-token',
    session: 'qa-ios',
    command: 'home',
    positionals: [],
    flags: {
      udid: 'SIM-999',
    },
    meta: {
      lockPolicy: 'reject',
    },
  });

  assert.equal(dispatchCalls, 0);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /--udid=SIM-999/i);
  }
});

test('batch steps cannot bypass reject lock policy on nested direct requests', async () => {
  const sessionStore = makeStore();
  sessionStore.set('qa-ios', makeIosSession('qa-ios'));
  let dispatchCalls = 0;

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
    dispatchCommand: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  const response = await handler({
    token: 'test-token',
    session: 'qa-ios',
    command: 'batch',
    positionals: [],
    flags: {
      batchSteps: [
        {
          command: 'home',
          flags: {
            serial: 'emulator-5554',
          },
        },
      ],
    },
    meta: {
      lockPolicy: 'reject',
    },
  });

  assert.equal(dispatchCalls, 0);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /Batch failed at step 1/i);
    assert.match(response.error.message, /--serial=emulator-5554/i);
  }
});

test('direct daemon requests apply strip lock policy for existing sessions before dispatch', async () => {
  const sessionStore = makeStore();
  sessionStore.set('qa-ios', makeIosSession('qa-ios'));
  let dispatchCalls = 0;

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
    dispatchCommand: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  const response = await handler({
    token: 'test-token',
    session: 'qa-ios',
    command: 'home',
    positionals: [],
    flags: {
      target: 'tv',
      udid: 'SIM-999',
      device: 'iPhone 16',
    },
    meta: {
      lockPolicy: 'strip',
    },
  });

  assert.equal(dispatchCalls, 1);
  assert.equal(response.ok, true);
  const action = sessionStore.get('qa-ios')?.actions.at(-1);
  assert.equal(action?.flags.platform, 'ios');
  assert.equal(action?.flags.udid, undefined);
  assert.equal(action?.flags.target, undefined);
  assert.equal(action?.flags.device, 'iPhone 16');
});

test('batch preserves tenant-scoped session names across nested requests', async () => {
  const sessionStore = makeStore();
  sessionStore.set('tenant-a:default', makeIosSession('tenant-a:default'));
  const leaseRegistry = new LeaseRegistry();
  const lease = leaseRegistry.allocateLease({
    tenantId: 'tenant-a',
    runId: 'run-1',
  });
  let dispatchCalls = 0;

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry,
    trackDownloadableArtifact: () => 'artifact-id',
    dispatchCommand: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'batch',
    positionals: [],
    flags: {
      batchSteps: [{ command: 'home' }],
    },
    meta: {
      tenantId: 'tenant-a',
      runId: 'run-1',
      leaseId: lease.leaseId,
      sessionIsolation: 'tenant',
    },
  });

  assert.equal(response.ok, true);
  assert.equal(dispatchCalls, 1);
  assert.equal(sessionStore.get('tenant-a:default')?.actions.at(-1)?.command, 'home');
});
