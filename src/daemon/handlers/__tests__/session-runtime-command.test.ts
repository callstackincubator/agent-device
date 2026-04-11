import { test, expect, vi } from 'vitest';
import type { SessionState } from '../../types.ts';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';

vi.mock('../../runtime-hints.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtime-hints.ts')>();
  return {
    ...actual,
    clearRuntimeHintsFromApp: vi.fn(async () => {}),
  };
});

import { handleRuntimeCommand } from '../session-runtime-command.ts';
import { clearRuntimeHintsFromApp } from '../../runtime-hints.ts';

test('runtime clear removes applied transport hints for the active app', async () => {
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
  expect(vi.mocked(clearRuntimeHintsFromApp)).toHaveBeenCalledWith({
    device: expect.objectContaining({ id: 'emulator-5554' }),
    appId: 'com.example.demo',
  });
  expect(sessionStore.getRuntimeHints(sessionName)).toBeUndefined();
});
