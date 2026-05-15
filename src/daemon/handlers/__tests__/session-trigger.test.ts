import { test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})), resolveTargetDevice: vi.fn() };
});
vi.mock('../../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));

import { handleSessionCommands } from '../session.ts';
import type { DaemonRequest, DaemonResponse } from '../../types.ts';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';

const invoke = async (_req: DaemonRequest): Promise<DaemonResponse> => {
  return {
    ok: false,
    error: { code: 'INVALID_ARGS', message: 'invoke should not be called in trigger tests' },
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

test('trigger-app-event requires active session or explicit device selector', async () => {
  const sessionStore = makeSessionStore('agent-device-session-trigger-');
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'trigger-app-event',
      positionals: ['screenshot_taken'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });
  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(false);
  if (response.ok) return;
  expect(response.error.code).toBe('INVALID_ARGS');
  expect(response.error.message).toMatch(/active session or an explicit device selector/i);
});
