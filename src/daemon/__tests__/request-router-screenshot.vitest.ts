import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})) };
});

import { dispatchCommand } from '../../core/dispatch.ts';
import { createRequestHandler } from '../request-router.ts';
import { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { LeaseRegistry } from '../lease-registry.ts';

const mockDispatch = vi.mocked(dispatchCommand);

const ANDROID_DEVICE: DeviceInfo = {
  platform: 'android',
  id: 'emulator-5554',
  name: 'Pixel',
  kind: 'emulator',
  booted: true,
};

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-router-screenshot-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeSession(name: string): SessionState {
  return {
    name,
    device: ANDROID_DEVICE,
    createdAt: Date.now(),
    actions: [],
  };
}

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
});

test('screenshot resolves relative positional path against request cwd', async () => {
  const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-screenshot-cwd-caller-'));
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));

  let capturedPath: string | undefined;
  mockDispatch.mockImplementation(async (_device, command, positionals) => {
    if (command === 'screenshot') {
      capturedPath = positionals[0];
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: ['evidence/test.png'],
    meta: { cwd: callerCwd, requestId: 'req-1' },
  });

  expect(capturedPath).toBeTruthy();
  expect(capturedPath).toBe(path.join(callerCwd, 'evidence/test.png'));
  expect(path.isAbsolute(capturedPath!)).toBe(true);
  const recordedAction = sessionStore.get('default')?.actions.at(-1);
  expect(recordedAction?.positionals).toEqual([path.join(callerCwd, 'evidence/test.png')]);
});

test('screenshot keeps absolute positional path unchanged', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));

  const absolutePath = path.join(os.tmpdir(), 'evidence/test.png');
  let capturedPath: string | undefined;

  mockDispatch.mockImplementation(async (_device, command, positionals) => {
    if (command === 'screenshot') {
      capturedPath = positionals[0];
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: [absolutePath],
    meta: { cwd: '/some/other/dir', requestId: 'req-2' },
  });

  expect(capturedPath).toBe(absolutePath);
  const recordedAction = sessionStore.get('default')?.actions.at(-1);
  expect(recordedAction?.positionals).toEqual([absolutePath]);
});

test('screenshot resolves --out flag path against request cwd', async () => {
  const callerCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-screenshot-out-cwd-'));
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default'));

  let capturedOut: string | undefined;

  mockDispatch.mockImplementation(async (_device, command, _positionals, outPath) => {
    if (command === 'screenshot') {
      capturedOut = outPath;
    }
    return {};
  });

  const handler = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    token: 'test-token',
    sessionStore,
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact: () => 'artifact-id',
  });

  await handler({
    token: 'test-token',
    session: 'default',
    command: 'screenshot',
    positionals: [],
    flags: { out: 'evidence/test.png' },
    meta: { cwd: callerCwd, requestId: 'req-3' },
  });

  expect(capturedOut).toBeTruthy();
  expect(capturedOut).toBe(path.join(callerCwd, 'evidence/test.png'));
  expect(path.isAbsolute(capturedOut!)).toBe(true);
  const recordedAction = sessionStore.get('default')?.actions.at(-1);
  expect(recordedAction?.flags.out).toBe(path.join(callerCwd, 'evidence/test.png'));
});
