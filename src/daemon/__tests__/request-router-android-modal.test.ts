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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-router-android-modal-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeAndroidSession(name: string): SessionState {
  return {
    name,
    createdAt: Date.now(),
    appBundleId: 'com.android.settings',
    actions: [],
    device: {
      platform: 'android',
      target: 'mobile',
      id: 'emulator-5554',
      name: 'Pixel 9 Pro XL',
      kind: 'emulator',
      booted: true,
    },
    recording: {
      platform: 'android',
      outPath: '/tmp/demo.mp4',
      remotePath: '/sdcard/demo.mp4',
      remotePid: '4242',
      startedAt: Date.now() - 1_000,
      showTouches: true,
      gestureEvents: [],
    },
  };
}

test('generic Android gesture commands dismiss blocking system dialogs during recording', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeAndroidSession('default'));
  const dispatchCalls: string[][] = [];
  const execCalls: string[][] = [];
  const reopenedApps: string[] = [];
  let snapshotCalls = 0;

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
    dispatchCommand: async (_device, command, positionals) => {
      dispatchCalls.push([command, ...positionals]);
      return {};
    },
    snapshotAndroidUi: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 1) {
        return {
          nodes: [
            {
              index: 0,
              type: 'android.widget.TextView',
              label: 'Process system is not responding',
              rect: { x: 50, y: 400, width: 500, height: 80 },
            },
            {
              index: 1,
              type: 'android.widget.Button',
              label: 'Close app',
              rect: { x: 100, y: 600, width: 220, height: 80 },
            },
          ],
        };
      }
      return { nodes: [] };
    },
    reopenAndroidApp: async (_device, app) => {
      reopenedApps.push(app);
    },
    readAndroidAppState: async () => ({ package: 'com.android.settings' }),
    execCommand: async (_cmd, args) => {
      execCalls.push(args);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'scroll',
    positionals: ['down', '0.55'],
    meta: { requestId: 'req-android-modal' },
  });

  assert.equal(response.ok, true);
  assert.deepEqual(dispatchCalls, [['scroll', 'down', '0.55']]);
  assert.deepEqual(execCalls, [['-s', 'emulator-5554', 'shell', 'input', 'tap', '210', '640']]);
  assert.deepEqual(reopenedApps, ['com.android.settings']);
  assert.equal(snapshotCalls, 2);
});
