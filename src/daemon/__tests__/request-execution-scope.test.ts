import { afterAll, test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { withDiagnosticsScope } from '../../utils/diagnostics.ts';
import {
  makeAndroidSession,
  makeIosSession,
} from '../../__tests__/test-utils/session-factories.ts';
import { makeSessionStore } from '../../__tests__/test-utils/store-factory.ts';
import { LeaseRegistry } from '../lease-registry.ts';
import { clearRequestCanceled, markRequestCanceled } from '../request-cancel.ts';
import {
  createRequestExecutionScope,
  prepareLockedRequestScope,
} from '../request-execution-scope.ts';
import type { DaemonRequest } from '../types.ts';

const TEST_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-request-execution-scope-'));
const LOG_PATH = path.join(TEST_ROOT, 'diagnostics.log');

afterAll(() => {
  fs.rmSync(TEST_ROOT, { recursive: true, force: true });
});

test('createRequestExecutionScope applies tenant scoping and lease admission', async () => {
  const sessionStore = makeSessionStore('agent-device-request-scope-');
  const leaseRegistry = new LeaseRegistry();
  const lease = leaseRegistry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });

  const scope = await createRequestExecutionScope({
    req: makeRequest({
      session: 'default',
      command: 'snapshot',
      meta: {
        tenantId: 'tenant-a',
        runId: 'run-1',
        leaseId: lease.leaseId,
        sessionIsolation: 'tenant',
      },
    }),
    sessionStore,
    leaseRegistry,
  });

  expect(scope.req.session).toBe('tenant-a:default');
  expect(scope.req.meta?.tenantId).toBe('tenant-a');
  expect(scope.sessionName).toBe('tenant-a:default');
});

test('createRequestExecutionScope rejects tenant requests without an active lease', async () => {
  await expect(
    createRequestExecutionScope({
      req: makeRequest({
        session: 'default',
        command: 'snapshot',
        meta: {
          tenantId: 'tenant-a',
          runId: 'run-1',
          leaseId: '0'.repeat(32),
          sessionIsolation: 'tenant',
        },
      }),
      sessionStore: makeSessionStore('agent-device-request-scope-'),
      leaseRegistry: new LeaseRegistry(),
    }),
  ).rejects.toThrow(/Lease is not active/);
});

test('prepareLockedRequestScope preserves existing-session selector validation', async () => {
  const sessionStore = makeSessionStore('agent-device-request-scope-');
  sessionStore.set('default', makeAndroidSession('default'));
  const scope = await createRequestExecutionScope({
    req: makeRequest({
      command: 'snapshot',
      flags: {
        platform: 'ios',
      },
    }),
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
  });

  expect(() =>
    prepareLockedRequestScope({
      scope,
      logPath: LOG_PATH,
      sessionStore,
      trackDownloadableArtifact: () => 'artifact-id',
    }),
  ).toThrow(/cannot be used with --platform=ios/i);
});

test('prepareLockedRequestScope blocks commands for invalidated recordings before handlers run', async () => {
  const sessionStore = makeSessionStore('agent-device-request-scope-');
  sessionStore.set(
    'default',
    makeIosSession('default', {
      recording: {
        platform: 'ios-device-runner',
        outPath: '/tmp/recording.mp4',
        remotePath: '/tmp/remote.mp4',
        startedAt: Date.now(),
        showTouches: true,
        gestureEvents: [],
        invalidatedReason: 'iOS runner session restarted during recording',
      },
    }),
  );
  const scope = await createRequestExecutionScope({
    req: makeRequest({ command: 'snapshot' }),
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
  });

  const result = await withDiagnosticsScope({ command: 'snapshot', logPath: LOG_PATH }, async () =>
    prepareLockedRequestScope({
      scope,
      logPath: LOG_PATH,
      sessionStore,
      trackDownloadableArtifact: () => 'artifact-id',
    }),
  );

  expect(result.type).toBe('response');
  if (result.type === 'response') {
    expect(result.response.ok).toBe(false);
    if (!result.response.ok) {
      expect(result.response.error.message).toBe('iOS runner session restarted during recording');
    }
  }
});

test('runLocked rejects a canceled request before executing work', async () => {
  const requestId = 'request-scope-canceled-before-lock';
  const scope = await createRequestExecutionScope({
    req: makeRequest({ meta: { requestId } }),
    sessionStore: makeSessionStore('agent-device-request-scope-'),
    leaseRegistry: new LeaseRegistry(),
  });

  markRequestCanceled(requestId);
  try {
    await expect(scope.runLocked(async () => 'ran')).rejects.toThrow(/request canceled/);
  } finally {
    clearRequestCanceled(requestId);
  }
});

test('runLocked rejects a request canceled while waiting for its execution lock', async () => {
  const requestId = 'request-scope-canceled-after-lock';
  const sessionStore = makeSessionStore('agent-device-request-scope-');
  sessionStore.set('default', makeIosSession('default'));
  const leaseRegistry = new LeaseRegistry();
  const first = await createRequestExecutionScope({
    req: makeRequest({ command: 'click' }),
    sessionStore,
    leaseRegistry,
  });
  const second = await createRequestExecutionScope({
    req: makeRequest({ command: 'click', meta: { requestId } }),
    sessionStore,
    leaseRegistry,
  });
  let releaseLock: () => void = () => {};
  const lockReleased = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const firstRun = first.runLocked(async () => await lockReleased);
  const secondRun = second.runLocked(async () => 'ran');
  const secondExpectation = expect(secondRun).rejects.toThrow(/request canceled/);

  markRequestCanceled(requestId);
  releaseLock();
  try {
    await firstRun;
    await secondExpectation;
  } finally {
    clearRequestCanceled(requestId);
  }
});

function makeRequest(overrides: Partial<DaemonRequest> = {}): DaemonRequest {
  return {
    token: 'test-token',
    session: 'default',
    command: 'snapshot',
    positionals: [],
    ...overrides,
  };
}
