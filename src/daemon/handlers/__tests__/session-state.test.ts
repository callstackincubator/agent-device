import { test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../platforms/android/devices.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/android/devices.ts')>();
  return { ...actual, ensureAndroidEmulatorBooted: vi.fn() };
});

import { handleSessionStateCommands } from '../session-state.ts';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';
import { ensureAndroidEmulatorBooted } from '../../../platforms/android/devices.ts';

const mockEnsureAndroidEmulatorBooted = vi.mocked(ensureAndroidEmulatorBooted);

beforeEach(() => {
  mockEnsureAndroidEmulatorBooted.mockReset();
});

test('boot rejects --headless outside Android directly', async () => {
  const response = await handleSessionStateCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'ios', headless: true },
    },
    sessionName: 'default',
    sessionStore: makeSessionStore('agent-device-session-state-'),
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('INVALID_ARGS');
    expect(response.error.message).toMatch(/supported only for Android emulators/i);
  }
  expect(mockEnsureAndroidEmulatorBooted).not.toHaveBeenCalled();
});

test('appstate returns missing-session error for explicit session flag', async () => {
  const response = await handleSessionStateCommands({
    req: {
      token: 't',
      session: 'named',
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', session: 'named' },
    },
    sessionName: 'named',
    sessionStore: makeSessionStore('agent-device-session-state-'),
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('SESSION_NOT_FOUND');
    expect(response.error.message).toMatch(/Run open with --session named first/i);
  }
  expect(mockEnsureAndroidEmulatorBooted).not.toHaveBeenCalled();
});
