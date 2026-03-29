import { test, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

let snapshotCalls = 0;
const dispatchCalls: string[][] = [];

vi.mock('../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch.ts')>();
  return {
    ...actual,
    dispatchCommand: vi.fn(async (_device: unknown, command: string, positionals: string[]) => {
      dispatchCalls.push([command, ...positionals]);
      return {};
    }),
  };
});

import { createRequestHandler } from '../request-router.ts';
import { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import { LeaseRegistry } from '../lease-registry.ts';

vi.mock('../../platforms/android/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../platforms/android/index.ts')>();
  return {
    ...actual,
    snapshotAndroid: vi.fn(async () => {
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
    }),
    openAndroidApp: vi.fn(async () => {}),
    getAndroidAppState: vi.fn(async () => ({ package: 'com.android.settings' })),
  };
});

const execCalls: string[][] = [];

vi.mock('../../utils/exec.ts', () => ({
  runCmd: vi.fn(async (_cmd: string, args: string[]) => {
    execCalls.push(args);
    return { stdout: '', stderr: '', exitCode: 0 };
  }),
}));

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
  snapshotCalls = 0;
  execCalls.length = 0;
  dispatchCalls.length = 0;

  const sessionStore = makeStore();
  sessionStore.set('default', makeAndroidSession('default'));

  const { openAndroidApp } = await import('../../platforms/android/index.ts');

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  const response = await handler({
    token: 'test-token',
    session: 'default',
    command: 'scroll',
    positionals: ['down', '0.55'],
    meta: { requestId: 'req-android-modal' },
  });

  expect(response.ok).toBe(true);
  expect(dispatchCalls).toEqual([['scroll', 'down', '0.55']]);
  expect(execCalls).toEqual([['-s', 'emulator-5554', 'shell', 'input', 'tap', '210', '640']]);
  expect(openAndroidApp).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'emulator-5554' }),
    'com.android.settings',
  );
  expect(snapshotCalls).toBe(2);
});
