import { beforeEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleReactNativeCommands } from '../react-native.ts';
import { captureSnapshot } from '../snapshot-capture.ts';
import { dispatchCommand } from '../../../core/dispatch.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';

vi.mock('../snapshot-capture.ts', () => ({
  captureSnapshot: vi.fn(),
}));

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return {
    ...actual,
    dispatchCommand: vi.fn(async () => ({ x: 379, y: 820 })),
  };
});

const mockCaptureSnapshot = vi.mocked(captureSnapshot);
const mockDispatchCommand = vi.mocked(dispatchCommand);

beforeEach(() => {
  mockCaptureSnapshot.mockReset();
  mockDispatchCommand.mockReset();
  mockDispatchCommand.mockResolvedValue({ x: 379, y: 820 });
});

test('react-native dismiss-overlay taps collapsed warning close affordance instead of banner center', async () => {
  const sessionName = 'rn-session';
  const sessionStore = makeSessionStore();
  sessionStore.set(sessionName, makeSession(sessionName));
  mockCaptureSnapshot.mockResolvedValue({
    snapshot: {
      nodes: [
        {
          index: 0,
          ref: 'e90',
          label: '!, Open debugger to view warnings.',
          rect: { x: 0, y: 794, width: 402, height: 52 },
          hittable: true,
        },
      ],
      createdAt: Date.now(),
    },
  });

  const response = await handleReactNativeCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'react-native',
      positionals: ['dismiss-overlay'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    contextFromFlags: () => ({}),
  });

  expect(response?.ok).toBe(true);
  expect(mockDispatchCommand).toHaveBeenCalledWith(
    expect.objectContaining({ platform: 'ios' }),
    'press',
    ['379', '820'],
    undefined,
    expect.any(Object),
  );
  expect(response?.ok && response.data).toMatchObject({
    action: 'dismiss-overlay',
    overlayAction: 'close-collapsed-banner',
    verified: false,
    verificationRequired: true,
    nextCommand: 'agent-device snapshot -i -c',
    x: 379,
    y: 820,
  });
});

test('react-native dismiss-overlay minimizes RedBox error overlays instead of dismissing them', async () => {
  const sessionName = 'rn-redbox-session';
  const sessionStore = makeSessionStore();
  sessionStore.set(sessionName, makeSession(sessionName));
  mockDispatchCommand.mockResolvedValue({ x: 265, y: 752 });
  mockCaptureSnapshot.mockResolvedValue({
    snapshot: {
      nodes: [
        {
          index: 0,
          ref: 'e1',
          label: 'Runtime Error',
          rect: { x: 0, y: 0, width: 390, height: 100 },
        },
        {
          index: 1,
          ref: 'e2',
          label: 'Dismiss',
          rect: { x: 20, y: 730, width: 150, height: 44 },
        },
        {
          index: 2,
          ref: 'e3',
          label: 'Minimize',
          rect: { x: 190, y: 730, width: 150, height: 44 },
        },
      ],
      createdAt: Date.now(),
    },
  });

  const response = await handleReactNativeCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'react-native',
      positionals: ['dismiss-overlay'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    contextFromFlags: () => ({}),
  });

  expect(response?.ok).toBe(true);
  expect(mockDispatchCommand).toHaveBeenCalledWith(
    expect.objectContaining({ platform: 'ios' }),
    'press',
    ['265', '752'],
    undefined,
    expect.any(Object),
  );
  expect(response?.ok && response.data).toMatchObject({
    action: 'dismiss-overlay',
    overlayAction: 'minimize',
    ref: 'e3',
    x: 265,
    y: 752,
  });
});

test('react-native dismiss-overlay falls back to Dismiss when RedBox Minimize is absent', async () => {
  const sessionName = 'rn-redbox-dismiss-session';
  const sessionStore = makeSessionStore();
  sessionStore.set(sessionName, makeSession(sessionName));
  mockDispatchCommand.mockResolvedValue({ x: 95, y: 752 });
  mockCaptureSnapshot.mockResolvedValue({
    snapshot: {
      nodes: [
        {
          index: 0,
          ref: 'e1',
          label: 'Runtime Error',
          rect: { x: 0, y: 0, width: 390, height: 100 },
        },
        {
          index: 1,
          ref: 'e2',
          label: 'Dismiss',
          rect: { x: 20, y: 730, width: 150, height: 44 },
        },
      ],
      createdAt: Date.now(),
    },
  });

  const response = await handleReactNativeCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'react-native',
      positionals: ['dismiss-overlay'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    contextFromFlags: () => ({}),
  });

  expect(response?.ok).toBe(true);
  expect(mockDispatchCommand).toHaveBeenCalledWith(
    expect.objectContaining({ platform: 'ios' }),
    'press',
    ['95', '752'],
    undefined,
    expect.any(Object),
  );
  expect(response?.ok && response.data).toMatchObject({
    action: 'dismiss-overlay',
    overlayAction: 'dismiss',
    ref: 'e2',
    warning: 'RedBox Minimize control was not exposed; used Dismiss fallback',
  });
});

test('react-native dismiss-overlay ignores app copy that only mentions RN overlay terms', async () => {
  const sessionName = 'rn-copy-session';
  const sessionStore = makeSessionStore();
  sessionStore.set(sessionName, makeSession(sessionName));
  mockCaptureSnapshot.mockResolvedValue({
    snapshot: {
      nodes: [
        {
          index: 0,
          ref: 'e1',
          label: 'Runtime error troubleshooting docs mention LogBox and RedBox',
          rect: { x: 0, y: 100, width: 390, height: 80 },
        },
      ],
      createdAt: Date.now(),
    },
  });

  const response = await handleReactNativeCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'react-native',
      positionals: ['dismiss-overlay'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    contextFromFlags: () => ({}),
  });

  expect(response?.ok).toBe(true);
  expect(mockDispatchCommand).not.toHaveBeenCalled();
  expect(response?.ok && response.data).toMatchObject({
    action: 'dismiss-overlay',
    detected: false,
    dismissed: false,
  });
});

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-rn-handler-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string): SessionState {
  return {
    name,
    createdAt: Date.now(),
    actions: [],
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone',
      kind: 'simulator',
      booted: true,
    },
  };
}
