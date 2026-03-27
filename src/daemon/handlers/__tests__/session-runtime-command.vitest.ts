import { test, expect, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';

const clearCalls: Array<{ deviceId: string; appId?: string }> = [];

vi.mock('../../runtime-hints.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtime-hints.ts')>();
  return {
    ...actual,
    clearRuntimeHintsFromApp: vi.fn(async ({ device, appId }) => {
      clearCalls.push({ deviceId: device.id, appId });
    }),
  };
});

import { handleRuntimeCommand } from '../session-runtime-command.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-runtime-cmd-'));
  return new SessionStore(path.join(root, 'sessions'));
}

test('runtime clear removes applied transport hints for the active app', async () => {
  clearCalls.length = 0;
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-clear-active';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
  });
  sessionStore.set(sessionName, {
    name: sessionName,
    createdAt: Date.now(),
    actions: [],
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
    appBundleId: 'com.example.demo',
  } as SessionState);

  const response = await handleRuntimeCommand({
    req: {
      token: 't',
      session: sessionName,
      command: 'runtime',
      positionals: ['clear'],
      flags: {},
    },
    sessionName,
    sessionStore,
  });

  expect(response.ok).toBe(true);
  expect(clearCalls).toEqual([{ deviceId: 'emulator-5554', appId: 'com.example.demo' }]);
  expect(sessionStore.getRuntimeHints(sessionName)).toBeUndefined();
});
