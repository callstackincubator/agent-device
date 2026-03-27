import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})), resolveTargetDevice: vi.fn() };
});
vi.mock('../../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));

import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { dispatchCommand, resolveTargetDevice } from '../../../core/dispatch.ts';

const mockDispatch = vi.mocked(dispatchCommand);
const mockResolveTargetDevice = vi.mocked(resolveTargetDevice);

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
  mockResolveTargetDevice.mockReset();
});

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-push-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.active',
  };
}

const invoke = async (_req: DaemonRequest): Promise<DaemonResponse> => {
  return {
    ok: false,
    error: { code: 'INVALID_ARGS', message: 'invoke should not be called in push tests' },
  };
};

test('push requires active session or explicit device selector', async () => {
  const sessionStore = makeStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'push',
      positionals: ['com.example.app', '{"aps":{"alert":"hi"}}'],
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

test('push uses session device and records action', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);
  mockDispatch.mockImplementation(async (device, command, positionals) => {
    expect(device.id).toBe('emulator-5554');
    expect(command).toBe('push');
    expect(positionals).toEqual(['com.example.app', '{"action":"com.example.PUSH"}']);
    return { platform: 'android', package: 'com.example.app', action: 'com.example.PUSH' };
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'push',
      positionals: ['com.example.app', '{"action":"com.example.PUSH"}'],
      flags: {},
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
  if (!response.ok) return;
  expect(response.data?.platform).toBe('android');
  expect(session.actions.length).toBe(1);
  expect(session.actions[0]?.command).toBe('push');
});

test('push expands payload file path from request cwd', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);

  let pushedPath = '';
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-push-payload-'));
  const payloadPath = path.join(tempRoot, 'payload.json');
  fs.writeFileSync(payloadPath, '{"action":"com.example.PUSH"}\n', 'utf8');

  mockDispatch.mockImplementation(async (_device, _command, positionals) => {
    pushedPath = positionals[1] ?? '';
    return {};
  });

  await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'push',
      positionals: ['com.example.app', './payload.json'],
      flags: {} as CommandFlags,
      meta: { cwd: tempRoot },
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });

  expect(pushedPath).toBe(payloadPath);
});

test('push treats brace-prefixed existing payload path as file', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);
  mockResolveTargetDevice.mockResolvedValue(session.device!);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-push-brace-file-'));
  const payloadPath = path.join(tempRoot, '{payload}.json');
  fs.writeFileSync(payloadPath, '{"action":"com.example.PUSH"}\n', 'utf8');

  let pushedPath = '';
  mockDispatch.mockImplementation(async (_device, _command, positionals) => {
    pushedPath = positionals[1] ?? '';
    return {};
  });

  await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'push',
      positionals: ['com.example.app', './{payload}.json'],
      flags: {} as CommandFlags,
      meta: { cwd: tempRoot },
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
  });

  expect(pushedPath).toBe(payloadPath);
});
