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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-router-recording-health-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

test('router blocks non-record commands when recording was invalidated', async () => {
  const sessionStore = makeStore();
  const session: SessionState = {
    name: 'default',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.apple.Preferences',
    device: {
      platform: 'ios',
      target: 'mobile',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    },
    recording: {
      platform: 'ios',
      outPath: '/tmp/demo.mp4',
      startedAt: Date.now() - 1_000,
      showTouches: true,
      gestureEvents: [],
      invalidatedReason: 'iOS runner session restarted during recording',
      child: { kill: () => {} } as any,
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    },
  };
  sessionStore.set('default', session);

  let dispatched = false;
  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
    dispatchCommand: async () => {
      dispatched = true;
      return {};
    },
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'scroll',
    positionals: ['down'],
    meta: { requestId: 'req-invalidated-recording' },
  });

  assert.equal(response.ok, false);
  if (response.ok) {
    return;
  }
  assert.equal(response.error.code, 'COMMAND_FAILED');
  assert.equal(response.error.message, 'iOS runner session restarted during recording');
  assert.equal(dispatched, false);
});
