import { test, expect, vi, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})) };
});

import { dispatchCommand } from '../../core/dispatch.ts';
import { createRequestHandler } from '../request-router.ts';
import type { SessionState } from '../types.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { makeSessionStore } from '../../__tests__/test-utils/store-factory.ts';

const mockDispatch = vi.mocked(dispatchCommand);

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

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
});

test('direct daemon requests cannot bypass reject lock policy for existing sessions', async () => {
  const sessionStore = makeSessionStore('agent-device-router-lock-');
  sessionStore.set('qa-ios', makeIosSession('qa-ios'));

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
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

  expect(mockDispatch).not.toHaveBeenCalled();
  expect(response.ok).toBe(false);
  if (!response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/--udid=SIM-999/i);
  }
});

test('batch steps cannot bypass reject lock policy on nested direct requests', async () => {
  const sessionStore = makeSessionStore('agent-device-router-lock-');
  sessionStore.set('qa-ios', makeIosSession('qa-ios'));

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
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

  expect(mockDispatch).not.toHaveBeenCalled();
  expect(response.ok).toBe(false);
  if (!response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/Batch failed at step 1/i);
    expect(response.error.message).toMatch(/--serial=emulator-5554/i);
  }
});

test('direct daemon requests apply strip lock policy for existing sessions before dispatch', async () => {
  const sessionStore = makeSessionStore('agent-device-router-lock-');
  sessionStore.set('qa-ios', makeIosSession('qa-ios'));
  let dispatchCalls = 0;
  mockDispatch.mockImplementation(async () => {
    dispatchCalls += 1;
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
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

  expect(dispatchCalls).toBe(1);
  expect(response.ok).toBe(true);
  const action = sessionStore.get('qa-ios')?.actions.at(-1);
  expect(action?.flags.platform).toBe('ios');
  expect(action?.flags.udid).toBe(undefined);
  expect(action?.flags.target).toBe(undefined);
  expect(action?.flags.device).toBe('iPhone 16');
});

test('batch preserves tenant-scoped session names across nested requests', async () => {
  const sessionStore = makeSessionStore('agent-device-router-lock-');
  sessionStore.set('tenant-a:default', makeIosSession('tenant-a:default'));
  const leaseRegistry = new LeaseRegistry();
  const lease = leaseRegistry.allocateLease({
    tenantId: 'tenant-a',
    runId: 'run-1',
  });
  let dispatchCalls = 0;
  mockDispatch.mockImplementation(async () => {
    dispatchCalls += 1;
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry,
    trackDownloadableArtifact: () => 'artifact-id',
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

  expect(response.ok).toBe(true);
  expect(dispatchCalls).toBe(1);
  expect(sessionStore.get('tenant-a:default')?.actions.at(-1)?.command).toBe('home');
});
