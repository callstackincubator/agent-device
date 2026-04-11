import { test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})), resolveTargetDevice: vi.fn() };
});
vi.mock('../../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));
vi.mock('../session-open-target.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session-open-target.ts')>();
  return { ...actual, resolveAndroidPackageForOpen: vi.fn(async () => undefined) };
});

import { handleSessionCommands } from '../session.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import { dispatchCommand, resolveTargetDevice } from '../../../core/dispatch.ts';
import { resolveAndroidPackageForOpen } from '../session-open-target.ts';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';
import { makeSession as makeBaseSession } from '../../../__tests__/test-utils/session-factories.ts';

const mockDispatch = vi.mocked(dispatchCommand);
const mockResolveTargetDevice = vi.mocked(resolveTargetDevice);
const mockResolveAndroidPackage = vi.mocked(resolveAndroidPackageForOpen);

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
  mockResolveTargetDevice.mockReset();
  mockResolveAndroidPackage.mockReset();
  mockResolveAndroidPackage.mockResolvedValue(undefined);
});

function makeSession(name: string, device: SessionState['device']): SessionState {
  return makeBaseSession(name, {
    device,
    appName: 'ExampleApp',
    appBundleId: 'com.example.app',
  });
}

const invoke = async (_req: DaemonRequest): Promise<DaemonResponse> => {
  return {
    ok: false,
    error: { code: 'INVALID_ARGS', message: 'invoke should not be called in trigger tests' },
  };
};

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

test('trigger-app-event supports explicit selector without active session', async () => {
  const sessionStore = makeSessionStore('agent-device-session-trigger-');
  mockResolveTargetDevice.mockResolvedValue({
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  mockDispatch.mockImplementation(async (device, command, positionals) => {
    expect(device.platform).toBe('android');
    expect(command).toBe('trigger-app-event');
    expect(positionals).toEqual(['screenshot_taken']);
    return {
      event: 'screenshot_taken',
      eventUrl: 'myapp://agent-device/event?name=screenshot_taken',
    };
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'trigger-app-event',
      positionals: ['screenshot_taken'],
      flags: { platform: 'android' },
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });

  expect(mockDispatch).toHaveBeenCalled();
  expect(response).toBeTruthy();
  if (!response) return;
  expect(response.ok).toBe(true);
});

test('trigger-app-event records action and refreshes session app bundle context', async () => {
  const sessionStore = makeSessionStore('agent-device-session-trigger-');
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  mockResolveAndroidPackage.mockResolvedValue('com.updated.app');
  mockDispatch.mockResolvedValue({
    event: 'screenshot_taken',
    eventUrl: 'com.updated.app',
  });

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
  expect(response.ok).toBe(true);
  const nextSession = sessionStore.get('default');
  expect(nextSession).toBeTruthy();
  expect(nextSession?.appBundleId).toBe('com.updated.app');
  expect(nextSession?.actions.length).toBe(1);
  expect(nextSession?.actions[0]?.command).toBe('trigger-app-event');
  expect(nextSession?.actions[0]?.positionals).toEqual(['screenshot_taken']);
});
