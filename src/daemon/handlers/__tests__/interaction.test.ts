import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unsupportedRefSnapshotFlags } from '../interaction.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { attachRefs } from '../../../utils/snapshot.ts';
import { buildSnapshotState } from '../snapshot-capture.ts';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return {
    ...actual,
    dispatchCommand: vi.fn(async () => ({})),
  };
});

vi.mock('../../../platforms/android/index.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/android/index.ts')>();
  return {
    ...actual,
    getAndroidScreenSize: vi.fn(async () => ({ width: 1344, height: 2992 })),
  };
});

vi.mock('../interaction-snapshot.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../interaction-snapshot.ts')>();
  return {
    ...actual,
    captureSnapshotForSession: vi.fn(async () => ({
      nodes: [],
      createdAt: 0,
      backend: 'xctest' as const,
    })),
  };
});

import { dispatchCommand } from '../../../core/dispatch.ts';
import { getAndroidScreenSize } from '../../../platforms/android/index.ts';
import { captureSnapshotForSession } from '../interaction-snapshot.ts';
import { handleInteractionCommands } from '../interaction.ts';

const mockDispatch = vi.mocked(dispatchCommand);
const mockGetAndroidScreenSize = vi.mocked(getAndroidScreenSize);
const mockCaptureSnapshotForSession = vi.mocked(captureSnapshotForSession);

async function emulateCaptureSnapshotForSession(
  session: SessionState,
  flags: CommandFlags | undefined,
  sessionStore: SessionStore,
  contextFromFlags: (
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ) => Record<string, unknown>,
  options: { interactiveOnly: boolean },
) {
  const effectiveFlags = {
    ...(flags ?? {}),
    snapshotInteractiveOnly: options.interactiveOnly,
    snapshotCompact: options.interactiveOnly,
  };
  const snapshotData = (await mockDispatch(
    session.device,
    'snapshot',
    [],
    effectiveFlags.out,
    contextFromFlags(effectiveFlags, session.appBundleId, session.trace?.outPath),
  )) as { nodes?: never[]; truncated?: boolean; backend?: 'xctest' | 'android' | 'macos-helper' };
  const snapshot = buildSnapshotState(snapshotData ?? {}, effectiveFlags.snapshotRaw);
  session.snapshot = snapshot;
  sessionStore.set(session.name, session);
  return snapshot;
}

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-interaction-handler-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
}

function makeAndroidSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel 9 Pro XL',
      kind: 'emulator',
      target: 'mobile',
      booted: true,
    },
    createdAt: Date.now(),
    appBundleId: 'com.android.settings',
    actions: [],
  };
}

function makeScrollSnapshot(nodes: Parameters<typeof attachRefs>[0]) {
  return {
    nodes: attachRefs(nodes),
    createdAt: Date.now(),
    backend: 'xctest' as const,
  };
}

function makeScrollSession(
  sessionStore: SessionStore,
  sessionName: string,
  nodes: Parameters<typeof attachRefs>[0],
): SessionState {
  const session = makeSession(sessionName);
  session.snapshot = makeScrollSnapshot(nodes);
  sessionStore.set(sessionName, session);
  return session;
}

function makeMacOsDesktopSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'macos',
      id: 'macos-host',
      name: 'Mac',
      kind: 'device',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
    surface: 'desktop',
  };
}

function makeMacOsMenubarSession(name: string): SessionState {
  return {
    ...makeMacOsDesktopSession(name),
    surface: 'menubar',
  };
}

const contextFromFlags = (flags: CommandFlags | undefined) => ({
  count: flags?.count,
  intervalMs: flags?.intervalMs,
  delayMs: flags?.delayMs,
  holdMs: flags?.holdMs,
  jitterPx: flags?.jitterPx,
  doubleTap: flags?.doubleTap,
  clickButton: flags?.clickButton,
});

beforeEach(() => {
  mockDispatch.mockReset();
  mockDispatch.mockResolvedValue({});
  mockGetAndroidScreenSize.mockReset();
  mockGetAndroidScreenSize.mockResolvedValue({ width: 1344, height: 2992 });
  mockCaptureSnapshotForSession.mockReset();
  mockCaptureSnapshotForSession.mockImplementation(emulateCaptureSnapshotForSession);
});

test('unsupportedRefSnapshotFlags returns unsupported snapshot flags for @ref flows', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    snapshotDepth: 2,
    snapshotScope: 'Login',
    snapshotRaw: true,
  });
  expect(unsupported).toEqual(['--depth', '--scope', '--raw']);
});

test('unsupportedRefSnapshotFlags returns empty when no ref-unsupported flags are present', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    platform: 'ios',
    session: 'default',
    verbose: true,
  });
  expect(unsupported).toEqual([]);
});

test('get text prefers underlying value for text surfaces and avoids recording giant ref labels', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'get-text-editor';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        depth: 0,
        type: 'TextView',
        label: 'Editor for MainActivity.kt',
        value: 'package com.example.app\nclass MainActivity {}',
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockRejectedValue(
    new Error('dispatch should not be called for snapshot-derived get text'),
  );

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'get',
      positionals: ['text', '@e1'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.ref).toBe('e1');
    expect(response.data?.text).toBe('package com.example.app\nclass MainActivity {}');
  }

  const recorded = sessionStore.get(sessionName)?.actions.at(-1);
  expect(recorded?.result?.text).toBe('package com.example.app\nclass MainActivity {}');
  expect(recorded?.result?.refLabel).toBeUndefined();
});

test('get text uses backend read expansion when the resolved node has a rect', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'get-text-backend-read';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        depth: 0,
        type: 'TextView',
        label: 'Editor for MainActivity.kt',
        value: 'preview only',
        rect: { x: 20, y: 40, width: 120, height: 80 },
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({
    action: 'read',
    text: 'package com.example.app\nclass MainActivity {}',
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'get',
      positionals: ['text', '@e1'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('read');
  expect(mockDispatch.mock.calls[0]?.[2]).toEqual(['80', '80']);
  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.text).toBe('package com.example.app\nclass MainActivity {}');
  }
});

test('press coordinates dispatches press and records as press', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const storedSession = makeSession(sessionName);
  sessionStore.set(sessionName, storedSession);

  mockDispatch.mockResolvedValue({ ok: true });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['100', '200'],
      flags: { count: 3, intervalMs: 1, doubleTap: true },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('press');
  expect(mockDispatch.mock.calls[0]?.[2]).toEqual(['100', '200']);
  const context = mockDispatch.mock.calls[0]?.[4] as Record<string, unknown> | undefined;
  expect(context?.count).toBe(3);
  expect(context?.intervalMs).toBe(1);
  expect(context?.doubleTap).toBe(true);

  const session = sessionStore.get(sessionName);
  expect(session).toBeTruthy();
  expect(session?.actions.length).toBe(1);
  expect(session?.actions[0]?.command).toBe('press');
  expect(session?.actions[0]?.positionals).toEqual(['100', '200']);
});

test('click rejects macOS desktop surface interactions until helper routing exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-desktop-click';
  sessionStore.set(sessionName, makeMacOsDesktopSession(sessionName));

  mockDispatch.mockRejectedValue(new Error('dispatch should not be called'));

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'click',
      positionals: ['100', '200'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('UNSUPPORTED_OPERATION');
    expect(response.error.message).toMatch(/macOS desktop sessions/);
  }
});

test('fill rejects macOS menubar surface interactions until helper routing exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-menubar-fill';
  sessionStore.set(sessionName, makeMacOsMenubarSession(sessionName));

  mockDispatch.mockRejectedValue(new Error('dispatch should not be called'));

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'fill',
      positionals: ['@e2', 'hello'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('UNSUPPORTED_OPERATION');
    expect(response.error.message).toMatch(/macOS menubar sessions/);
  }
});

test('press coordinates appends touch-visualization events while recording', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeApplication',
        rect: { x: 0, y: 0, width: 402, height: 874 },
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  session.recording = {
    platform: 'ios',
    outPath: '/tmp/demo.mp4',
    startedAt: Date.now() - 1_000,
    showTouches: true,
    gestureEvents: [],
    child: { kill: () => {} } as any,
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ ok: true });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['100', '200'],
      flags: { count: 2, intervalMs: 150, doubleTap: true },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response?.ok).toBe(true);
  const recorded = sessionStore.get(sessionName)?.recording;
  expect(recorded).toBeTruthy();
  expect(recorded?.gestureEvents.length).toBe(4);
  expect(recorded?.gestureEvents[0]?.kind).toBe('tap');
  expect(recorded?.gestureEvents[0]?.x).toBe(100);
  expect(recorded?.gestureEvents[0]?.y).toBe(200);
  expect(recorded?.gestureEvents[0]?.referenceWidth).toBe(402);
  expect(recorded?.gestureEvents[0]?.referenceHeight).toBe(874);
});

test('press coordinates on Android recording uses physical screen size when no snapshot exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-direct-press-frame';
  const session = makeAndroidSession(sessionName);
  session.recording = {
    platform: 'android',
    outPath: '/tmp/demo.mp4',
    remotePath: '/sdcard/demo.mp4',
    remotePid: '1234',
    startedAt: Date.now() - 1_000,
    showTouches: true,
    gestureEvents: [],
  };
  session.snapshot = undefined;
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ x: 300, y: 2300 });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['300', '2300'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response?.ok).toBe(true);
  const event = sessionStore.get(sessionName)?.recording?.gestureEvents[0];
  expect(event?.kind).toBe('tap');
  expect(event?.referenceWidth).toBe(1344);
  expect(event?.referenceHeight).toBe(2992);
});

test('press coordinates on Android recording caches physical screen size across interactions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-direct-press-frame-cache';
  const session = makeAndroidSession(sessionName);
  session.recording = {
    platform: 'android',
    outPath: '/tmp/demo.mp4',
    remotePath: '/sdcard/demo.mp4',
    remotePid: '1234',
    startedAt: Date.now() - 1_000,
    showTouches: true,
    gestureEvents: [],
  };
  session.snapshot = undefined;
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ x: 300, y: 2300 });

  await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['300', '2300'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  mockDispatch.mockResolvedValue({ x: 320, y: 2200 });

  await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['320', '2200'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(mockGetAndroidScreenSize).toHaveBeenCalledTimes(1);
  const recording = sessionStore.get(sessionName)?.recording;
  expect(recording?.touchReferenceFrame).toEqual({
    referenceWidth: 1344,
    referenceHeight: 2992,
  });
});

test('press coordinates without recording skips Android screen-size lookup', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-direct-press-no-recording';
  const session = makeAndroidSession(sessionName);
  session.snapshot = undefined;
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ x: 300, y: 2300 });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['300', '2300'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response?.ok).toBe(true);
  expect(mockGetAndroidScreenSize).not.toHaveBeenCalled();
});

test('press coordinates during recording still dispatches when Android screen-size lookup fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-direct-press-screen-size-failure';
  const session = makeAndroidSession(sessionName);
  session.recording = {
    platform: 'android',
    outPath: '/tmp/demo.mp4',
    remotePath: '/sdcard/demo.mp4',
    remotePid: '1234',
    startedAt: Date.now() - 1_000,
    showTouches: true,
    gestureEvents: [],
  };
  session.snapshot = undefined;
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ x: 300, y: 2300 });
  mockGetAndroidScreenSize.mockRejectedValue(new Error('adb unavailable'));

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['300', '2300'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response?.ok).toBe(true);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  const event = sessionStore.get(sessionName)?.recording?.gestureEvents[0];
  expect(event?.kind).toBe('tap');
  expect(event?.x).toBe(300);
  expect(event?.y).toBe(2300);
  expect(event?.referenceWidth).toBeUndefined();
  expect(event?.referenceHeight).toBeUndefined();
});

test('press @ref preserves native timing in recorded result and touch visualization', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeButton',
        label: 'Continue',
        identifier: 'auth_continue',
        rect: { x: 10, y: 20, width: 100, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  session.recording = {
    platform: 'ios',
    outPath: '/tmp/demo.mp4',
    startedAt: 1_000,
    showTouches: true,
    gestureEvents: [],
    child: { kill: () => {} } as any,
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  };
  sessionStore.set(sessionName, session);

  const originalNow = Date.now;
  let now = 1_500;
  Date.now = () => now;

  try {
    mockDispatch.mockImplementation(async () => {
      now = 1_650;
      return {
        gestureStartUptimeMs: 5_100,
        gestureEndUptimeMs: 5_180,
      };
    });

    const response = await handleInteractionCommands({
      req: {
        token: 't',
        session: sessionName,
        command: 'press',
        positionals: ['@e1'],
        flags: {},
      },
      sessionName,
      sessionStore,
      contextFromFlags,
    });

    expect(response?.ok).toBe(true);
  } finally {
    Date.now = originalNow;
  }

  const stored = sessionStore.get(sessionName);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.gestureStartUptimeMs).toBe(5_100);
  expect(result.gestureEndUptimeMs).toBe(5_180);
  expect(stored?.recording?.gestureEvents[0]?.tMs).toBe(570);
});

test('press @ref resolves snapshot node and records press action', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeButton',
        label: 'Continue',
        identifier: 'auth_continue',
        rect: { x: 10, y: 20, width: 100, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ pressed: true });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['@e1'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.ref).toBe('e1');
    expect(response.data?.x).toBe(60);
    expect(response.data?.y).toBe(40);
  }
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('press');
  expect(mockDispatch.mock.calls[0]?.[2]).toEqual(['60', '40']);

  const stored = sessionStore.get(sessionName);
  expect(stored).toBeTruthy();
  expect(stored?.actions.length).toBe(1);
  expect(stored?.actions[0]?.command).toBe('press');
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.ref).toBe('e1');
  expect(Array.isArray(result.selectorChain)).toBe(true);
});

test('press @ref promotes a non-hittable node to its hittable ancestor before tapping', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeCell',
        label: 'Settings row',
        rect: { x: 20, y: 100, width: 320, height: 72 },
        enabled: true,
        hittable: true,
      },
      {
        index: 1,
        parentIndex: 0,
        type: 'XCUIElementTypeStaticText',
        label: 'Settings',
        rect: { x: 44, y: 124, width: 84, height: 20 },
        enabled: false,
        hittable: false,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ pressed: true });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['@e2'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.ref).toBe('e2');
    expect(response.data?.x).toBe(180);
    expect(response.data?.y).toBe(136);
  }
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('press');
  expect(mockDispatch.mock.calls[0]?.[2]).toEqual(['180', '136']);

  const stored = sessionStore.get(sessionName);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.ref).toBe('e2');
  expect(Array.isArray(result.selectorChain)).toBe(true);
});

test('fill @ref preserves fallback coordinates for recording when platform result is sparse', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeTextField',
        label: 'Email',
        identifier: 'auth_email',
        rect: { x: 10, y: 20, width: 100, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  session.recording = {
    platform: 'ios',
    outPath: '/tmp/demo.mp4',
    startedAt: Date.now() - 1_000,
    showTouches: true,
    gestureEvents: [],
    child: { kill: () => {} } as any,
    wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ filled: true });
  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'fill',
      positionals: ['@e1', 'hello@example.com'],
      flags: { delayMs: 55 },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.filled).toBe(true);
    expect(response.data?.x).toBeUndefined();
  }

  const stored = sessionStore.get(sessionName);
  expect(stored).toBeTruthy();
  const fillCalls = mockDispatch.mock.calls.filter((c) => c[1] === 'fill');
  expect(fillCalls.length).toBe(1);
  expect((fillCalls[0]?.[4] as Record<string, unknown> | undefined)?.delayMs).toBe(55);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.ref).toBe('e1');
  expect(result.x).toBe(60);
  expect(result.y).toBe(40);
  expect(Array.isArray(result.selectorChain)).toBe(true);

  const event = stored?.recording?.gestureEvents[0];
  expect(event?.kind).toBe('tap');
  expect(event?.x).toBe(60);
  expect(event?.y).toBe(40);
});

test('fill @ref keeps the original editable node when its parent is the hittable ancestor', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeCell',
        label: 'Email row',
        rect: { x: 20, y: 100, width: 320, height: 72 },
        enabled: true,
        hittable: true,
      },
      {
        index: 1,
        parentIndex: 0,
        type: 'XCUIElementTypeTextField',
        label: 'Email',
        identifier: 'auth_email',
        rect: { x: 44, y: 120, width: 200, height: 32 },
        enabled: true,
        hittable: false,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ filled: true });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'fill',
      positionals: ['@e2', 'hello@example.com'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  const fillCalls = mockDispatch.mock.calls.filter((c) => c[1] === 'fill');
  expect(fillCalls.length).toBe(1);
  expect(fillCalls[0]?.[2]).toEqual(['144', '136', 'hello@example.com']);

  const stored = sessionStore.get(sessionName);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.ref).toBe('e2');
});

test('click --button secondary on @ref dispatches a secondary press on macOS and records click', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.device = {
    platform: 'macos',
    id: 'macos-desktop',
    name: 'My Mac',
    kind: 'device',
    booted: true,
  };
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'XCUIElementTypeCell',
        label: 'failed-step.json',
        rect: { x: 400, y: 500, width: 200, height: 20 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockResolvedValue({ button: 'secondary' });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'click',
      positionals: ['@e1'],
      flags: { clickButton: 'secondary' },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('press');
  expect(mockDispatch.mock.calls[0]?.[2]).toEqual(['500', '510']);
  const context = mockDispatch.mock.calls[0]?.[4] as Record<string, unknown> | undefined;
  expect(context?.clickButton).toBe('secondary');
  if (response?.ok) {
    expect(response.data?.button).toBe('secondary');
    expect(response.data?.ref).toBe('e1');
  }

  const stored = sessionStore.get(sessionName);
  expect(stored).toBeTruthy();
  expect(stored?.actions[0]?.command).toBe('click');
  expect(stored?.actions[0]?.flags.clickButton).toBe('secondary');
});

test('click --button middle on macOS fails with an explicit unsupported-operation error', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.device = {
    platform: 'macos',
    id: 'macos-desktop',
    name: 'My Mac',
    kind: 'device',
    booted: true,
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockRejectedValue(
    new Error('dispatch should not be called for unsupported middle click'),
  );

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'click',
      positionals: ['100', '200'],
      flags: { clickButton: 'middle' },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('UNSUPPORTED_OPERATION');
    expect(response.error.message).toMatch(/middle is not supported/i);
  }
});

test('press @ref refreshes snapshot when stored ref bounds are invalid', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.device = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel 8 Pro',
    kind: 'emulator',
    booted: true,
  };
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'android.widget.TextView',
        label: 'My App',
        rect: { x: 20, y: 40, width: Number.NaN, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'android',
  };
  sessionStore.set(sessionName, session);

  let snapshotCalls = 0;
  mockDispatch.mockImplementation(async (_device, command, _positionals) => {
    if (command === 'snapshot') {
      snapshotCalls += 1;
      return {
        nodes: [
          {
            index: 0,
            type: 'android.widget.TextView',
            label: 'My App',
            rect: { x: 20, y: 40, width: 100, height: 40 },
            enabled: true,
            hittable: true,
          },
        ],
        backend: 'android',
      };
    }
    return { pressed: true };
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['@e1'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(snapshotCalls).toBe(1);
  const pressCalls = mockDispatch.mock.calls.filter((c) => c[1] === 'press');
  expect(pressCalls.length).toBe(1);
  expect(pressCalls[0]?.[2]).toEqual(['70', '60']);
  if (response?.ok) {
    expect(response.data?.x).toBe(70);
    expect(response.data?.y).toBe(60);
    expect(response.data?.ref).toBe('e1');
  }
});

test('press @ref fallback label is used after refresh when ref bounds remain invalid', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.device = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel 8 Pro',
    kind: 'emulator',
    booted: true,
  };
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'android.widget.TextView',
        label: 'My App',
        rect: { x: 20, y: 40, width: Number.NaN, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'android',
  };
  sessionStore.set(sessionName, session);

  mockDispatch.mockImplementation(async (_device, command) => {
    if (command === 'snapshot') {
      return {
        nodes: [
          {
            index: 0,
            type: 'android.widget.TextView',
            label: 'Different',
            rect: { x: 20, y: 40, width: Number.NaN, height: 40 },
            enabled: true,
            hittable: true,
          },
          {
            index: 1,
            type: 'android.widget.TextView',
            label: 'My App',
            rect: { x: 100, y: 200, width: 80, height: 40 },
            enabled: true,
            hittable: true,
          },
        ],
        backend: 'android',
      };
    }
    return { pressed: true };
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['@e1', 'My App'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  const pressCalls = mockDispatch.mock.calls.filter((c) => c[1] === 'press');
  expect(pressCalls.length).toBe(1);
  expect(pressCalls[0]?.[2]).toEqual(['140', '220']);
  if (response?.ok) {
    expect(response.data?.x).toBe(140);
    expect(response.data?.y).toBe(220);
  }
});

test('fill @ref refreshes snapshot when stored ref bounds are invalid', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.device = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel 8 Pro',
    kind: 'emulator',
    booted: true,
  };
  session.snapshot = {
    nodes: attachRefs([
      {
        index: 0,
        type: 'android.widget.EditText',
        label: 'Email',
        rect: { x: 20, y: 40, width: Number.NaN, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'android',
  };
  sessionStore.set(sessionName, session);

  let snapshotCalls = 0;
  mockDispatch.mockImplementation(async (_device, command) => {
    if (command === 'snapshot') {
      snapshotCalls += 1;
      return {
        nodes: [
          {
            index: 0,
            type: 'android.widget.EditText',
            label: 'Email',
            rect: { x: 20, y: 40, width: 100, height: 40 },
            enabled: true,
            hittable: true,
          },
        ],
        backend: 'android',
      };
    }
    return { filled: true };
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'fill',
      positionals: ['@e1', 'hello@example.com'],
      flags: { delayMs: 25 },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(snapshotCalls).toBe(1);
  const fillCalls = mockDispatch.mock.calls.filter((c) => c[1] === 'fill');
  expect(fillCalls.length).toBe(1);
  expect(fillCalls[0]?.[2]).toEqual(['70', '60', 'hello@example.com']);
  expect((fillCalls[0]?.[4] as Record<string, unknown> | undefined)?.delayMs).toBe(25);

  const stored = sessionStore.get(sessionName);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.ref).toBe('e1');
  expect(result.x).toBe(70);
  expect(result.y).toBe(60);
});

test('press coordinates does not treat extra trailing args as selector', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  mockDispatch.mockResolvedValue({ ok: true });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'press',
      positionals: ['100', '200', 'extra'],
      flags: { count: 2 },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockDispatch).toHaveBeenCalledTimes(1);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('press');
  expect(mockDispatch.mock.calls[0]?.[2]).toEqual(['100', '200']);
  expect(sessionStore.get(sessionName)?.actions.length).toBe(1);
});

test('scrollintoview @ref dispatches geometry-based swipe series with verification snapshots', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  makeScrollSession(sessionStore, sessionName, [
    {
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      index: 1,
      type: 'XCUIElementTypeStaticText',
      label: 'Far item',
      rect: { x: 20, y: 2600, width: 120, height: 40 },
    },
  ]);

  let snapshotCallCount = 0;
  mockCaptureSnapshotForSession.mockImplementation(async (activeSession) => {
    snapshotCallCount += 1;
    activeSession.snapshot = makeScrollSnapshot([
      { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
      ...(snapshotCallCount === 1
        ? [
            {
              index: 1,
              type: 'XCUIElementTypeStaticText',
              label: 'Inserted item',
              rect: { x: 20, y: 900, width: 120, height: 40 },
            },
          ]
        : []),
      {
        index: snapshotCallCount === 1 ? 2 : 1,
        type: 'XCUIElementTypeStaticText',
        label: 'Far item',
        rect:
          snapshotCallCount === 1
            ? { x: 20, y: 1300, width: 120, height: 40 }
            : { x: 20, y: 320, width: 120, height: 40 },
      },
    ]);
    return activeSession.snapshot;
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'scrollintoview',
      positionals: ['@e2'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockDispatch).toHaveBeenCalledTimes(2);
  expect(mockDispatch.mock.calls[0]?.[1]).toBe('swipe');
  expect(mockDispatch.mock.calls[0]?.[2]?.length).toBe(5);
  const context = mockDispatch.mock.calls[0]?.[4] as Record<string, unknown> | undefined;
  expect(context?.pattern).toBe('one-way');
  expect(context?.pauseMs).toBe(0);
  expect(context?.count).toBe(1);
  expect(mockDispatch.mock.calls[1]?.[1]).toBe('swipe');
  expect(snapshotCallCount).toBe(2);

  const stored = sessionStore.get(sessionName);
  expect(stored).toBeTruthy();
  expect(stored?.actions.length).toBe(1);
  expect(stored?.actions[0]?.command).toBe('scrollintoview');
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  expect(result.ref).toBe('e2');
  expect(result.attempts).toBe(2);
});

test('scrollintoview @ref returns immediately when target is already in viewport safe band', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  makeScrollSession(sessionStore, sessionName, [
    {
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      index: 1,
      type: 'XCUIElementTypeStaticText',
      label: 'Visible item',
      rect: { x: 20, y: 320, width: 120, height: 40 },
    },
  ]);

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'scrollintoview',
      positionals: ['@e2'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockDispatch).not.toHaveBeenCalled();
  if (response?.ok) {
    expect(response.data?.attempts).toBe(0);
    expect(response.data?.alreadyVisible).toBe(true);
  }
});

test('scrollintoview @ref missing from snapshot reports structured not-found details', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  makeScrollSession(sessionStore, sessionName, [
    {
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
  ]);

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'scrollintoview',
      positionals: ['@e2'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.message).toMatch(/not found/i);
    expect(response.error.details?.reason).toBe('not_found');
    expect(response.error.details?.attempts).toBe(0);
  }
});

test('scrollintoview @ref tolerates a single overshoot and recovers on the next swipe', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  makeScrollSession(sessionStore, sessionName, [
    {
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      index: 1,
      type: 'XCUIElementTypeStaticText',
      label: 'Edge item',
      rect: { x: 20, y: 700, width: 120, height: 40 },
    },
  ]);

  let snapshotCallCount = 0;
  mockCaptureSnapshotForSession.mockImplementation(async (activeSession) => {
    snapshotCallCount += 1;
    activeSession.snapshot = makeScrollSnapshot([
      { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
      {
        index: 1,
        type: 'XCUIElementTypeStaticText',
        label: 'Edge item',
        rect:
          snapshotCallCount === 1
            ? { x: 20, y: 0, width: 120, height: 40 }
            : { x: 20, y: 320, width: 120, height: 40 },
      },
    ]);
    return activeSession.snapshot;
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'scrollintoview',
      positionals: ['@e2'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(snapshotCallCount).toBe(2);
  if (response?.ok) {
    expect(response.data?.attempts).toBe(2);
  }
});

test('scrollintoview @ref stops when post-scroll snapshots make no progress', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  makeScrollSession(sessionStore, sessionName, [
    {
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      index: 1,
      type: 'XCUIElementTypeStaticText',
      label: 'Far item',
      rect: { x: 20, y: 2600, width: 120, height: 40 },
    },
  ]);

  let snapshotCallCount = 0;
  mockCaptureSnapshotForSession.mockImplementation(async (activeSession) => {
    snapshotCallCount += 1;
    activeSession.snapshot = makeScrollSnapshot([
      { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
      {
        index: 1,
        type: 'XCUIElementTypeStaticText',
        label: 'Far item',
        rect: { x: 20, y: 2600, width: 120, height: 40 },
      },
    ]);
    return activeSession.snapshot;
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'scrollintoview',
      positionals: ['@e2'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  expect(snapshotCallCount).toBe(2);
  if (response && !response.ok) {
    expect(response.error.message).toMatch(/made no progress/i);
    expect(response.error.details?.reason).toBe('not_found');
    expect(response.error.details?.attempts).toBe(2);
  }
});

test('scrollintoview @ref respects --max-scrolls before failing not found', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  makeScrollSession(sessionStore, sessionName, [
    {
      index: 0,
      type: 'Application',
      rect: { x: 0, y: 0, width: 390, height: 844 },
    },
    {
      index: 1,
      type: 'XCUIElementTypeStaticText',
      label: 'Far item',
      rect: { x: 20, y: 2600, width: 120, height: 40 },
    },
  ]);

  let snapshotCallCount = 0;
  mockCaptureSnapshotForSession.mockImplementation(async (activeSession) => {
    snapshotCallCount += 1;
    activeSession.snapshot = makeScrollSnapshot([
      { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
      {
        index: 1,
        type: 'XCUIElementTypeStaticText',
        label: 'Far item',
        rect:
          snapshotCallCount === 1
            ? { x: 20, y: 1900, width: 120, height: 40 }
            : { x: 20, y: 1200, width: 120, height: 40 },
      },
    ]);
    return activeSession.snapshot;
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'scrollintoview',
      positionals: ['@e2'],
      flags: { maxScrolls: 2 },
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  expect(snapshotCallCount).toBe(2);
  if (response && !response.ok) {
    expect(response.error.message).toMatch(/--max-scrolls=2/);
    expect(response.error.details?.reason).toBe('not_found');
    expect(response.error.details?.attempts).toBe(2);
  }
});

test('is visible captures one snapshot before evaluating selector predicate', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  mockDispatch.mockImplementation(async (_device, command) => {
    if (command === 'snapshot') {
      return {
        nodes: [
          {
            index: 0,
            type: 'XCUIElementTypeButton',
            label: 'Continue',
            identifier: 'auth_continue',
            rect: { x: 10, y: 20, width: 100, height: 40 },
            enabled: true,
            hittable: true,
            visible: true,
          },
        ],
        backend: 'xctest',
      };
    }
    throw new Error(`unexpected command: ${command}`);
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'is',
      positionals: ['visible', 'id=auth_continue'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  const snapshotCalls = mockDispatch.mock.calls.filter((c) => c[1] === 'snapshot');
  expect(snapshotCalls.length).toBe(1);
  if (response?.ok) {
    expect(response.data?.predicate).toBe('visible');
    expect(response.data?.pass).toBe(true);
    expect(response.data?.selector).toBe('id=auth_continue');
  }
});

test('is visible passes for list text that inherits viewport visibility from an ancestor', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'visible-list-item';
  sessionStore.set(sessionName, makeSession(sessionName));

  mockDispatch.mockImplementation(async (_device, command) => {
    if (command !== 'snapshot') throw new Error(`unexpected command: ${command}`);
    return {
      nodes: [
        { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
        {
          index: 1,
          parentIndex: 0,
          type: 'XCUIElementTypeCell',
          rect: { x: 0, y: 160, width: 390, height: 44 },
          hittable: false,
        },
        {
          index: 2,
          parentIndex: 1,
          type: 'XCUIElementTypeStaticText',
          label: 'Trip ideas',
          hittable: false,
        },
      ],
      backend: 'xctest',
    };
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'is',
      positionals: ['visible', 'label="Trip ideas"'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  if (response?.ok) {
    expect(response.data?.predicate).toBe('visible');
    expect(response.data?.pass).toBe(true);
    expect(response.data?.selector).toBe('label="Trip ideas"');
  }
});

test('is visible fails for nodes outside the current viewport', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'visible-offscreen';
  sessionStore.set(sessionName, makeSession(sessionName));

  mockDispatch.mockImplementation(async (_device, command) => {
    if (command !== 'snapshot') throw new Error(`unexpected command: ${command}`);
    return {
      nodes: [
        { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
        {
          index: 1,
          parentIndex: 0,
          type: 'XCUIElementTypeStaticText',
          label: 'Far item',
          rect: { x: 20, y: 2600, width: 120, height: 40 },
          hittable: false,
        },
      ],
      backend: 'xctest',
    };
  });

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'is',
      positionals: ['visible', 'label="Far item"'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(false);
  if (response && !response.ok) {
    expect(response.error.code).toBe('COMMAND_FAILED');
    expect(response.error.message).toMatch(/actual=\{"visible":false/);
  }
});
