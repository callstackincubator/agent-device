import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unsupportedRefSnapshotFlags } from '../interaction.ts';
import { handleInteractionCommands } from '../interaction.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { attachRefs } from '../../../utils/snapshot.ts';

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
  holdMs: flags?.holdMs,
  jitterPx: flags?.jitterPx,
  doubleTap: flags?.doubleTap,
  clickButton: flags?.clickButton,
});

test('unsupportedRefSnapshotFlags returns unsupported snapshot flags for @ref flows', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    snapshotDepth: 2,
    snapshotScope: 'Login',
    snapshotRaw: true,
  });
  assert.deepEqual(unsupported, ['--depth', '--scope', '--raw']);
});

test('unsupportedRefSnapshotFlags returns empty when no ref-unsupported flags are present', () => {
  const unsupported = unsupportedRefSnapshotFlags({
    platform: 'ios',
    session: 'default',
    verbose: true,
  });
  assert.deepEqual(unsupported, []);
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
    dispatch: async () => {
      throw new Error('dispatch should not be called for snapshot-derived get text');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response?.ok) {
    assert.equal(response.data?.ref, 'e1');
    assert.equal(response.data?.text, 'package com.example.app\nclass MainActivity {}');
  }

  const recorded = sessionStore.get(sessionName)?.actions.at(-1);
  assert.equal(recorded?.result?.text, 'package com.example.app\nclass MainActivity {}');
  assert.equal(recorded?.result?.refLabel, undefined);
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

  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
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
    dispatch: async (_device, command, positionals) => {
      dispatchCalls.push({ command, positionals });
      return { action: 'read', text: 'package com.example.app\nclass MainActivity {}' };
    },
  });

  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'read');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['80', '80']);
  assert.equal(response?.ok, true);
  if (response?.ok) {
    assert.equal(response.data?.text, 'package com.example.app\nclass MainActivity {}');
  }
});

test('press coordinates dispatches press and records as press', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const storedSession = makeSession(sessionName);
  sessionStore.set(sessionName, storedSession);

  const dispatchCalls: Array<{
    command: string;
    positionals: string[];
    context: Record<string, unknown> | undefined;
  }> = [];
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
    dispatch: async (_device, command, positionals, _out, context) => {
      dispatchCalls.push({
        command,
        positionals,
        context: context as Record<string, unknown> | undefined,
      });
      return { ok: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'press');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['100', '200']);
  assert.equal(dispatchCalls[0]?.context?.count, 3);
  assert.equal(dispatchCalls[0]?.context?.intervalMs, 1);
  assert.equal(dispatchCalls[0]?.context?.doubleTap, true);

  const session = sessionStore.get(sessionName);
  assert.ok(session);
  assert.equal(session?.actions.length, 1);
  assert.equal(session?.actions[0]?.command, 'press');
  assert.deepEqual(session?.actions[0]?.positionals, ['100', '200']);
});

test('click rejects macOS desktop surface interactions until helper routing exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-desktop-click';
  sessionStore.set(sessionName, makeMacOsDesktopSession(sessionName));

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
    dispatch: async () => {
      throw new Error('dispatch should not be called');
    },
  });

  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'UNSUPPORTED_OPERATION');
    assert.match(response.error.message, /macOS desktop sessions/);
  }
});

test('fill rejects macOS menubar surface interactions until helper routing exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-menubar-fill';
  sessionStore.set(sessionName, makeMacOsMenubarSession(sessionName));

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
    dispatch: async () => {
      throw new Error('dispatch should not be called');
    },
  });

  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'UNSUPPORTED_OPERATION');
    assert.match(response.error.message, /macOS menubar sessions/);
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
    dispatch: async () => ({ ok: true }),
  });

  assert.equal(response?.ok, true);
  const recorded = sessionStore.get(sessionName)?.recording;
  assert.ok(recorded);
  assert.equal(recorded?.gestureEvents.length, 4);
  assert.equal(recorded?.gestureEvents[0]?.kind, 'tap');
  assert.equal(recorded?.gestureEvents[0]?.x, 100);
  assert.equal(recorded?.gestureEvents[0]?.y, 200);
  assert.equal(recorded?.gestureEvents[0]?.referenceWidth, 402);
  assert.equal(recorded?.gestureEvents[0]?.referenceHeight, 874);
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
    dispatch: async () => ({ x: 300, y: 2300 }),
    readAndroidScreenSize: async () => ({ width: 1344, height: 2992 }),
  });

  assert.equal(response?.ok, true);
  const event = sessionStore.get(sessionName)?.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'tap');
  assert.equal(event?.referenceWidth, 1344);
  assert.equal(event?.referenceHeight, 2992);
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

  let screenSizeReads = 0;
  const readAndroidScreenSize = async () => {
    screenSizeReads += 1;
    return { width: 1344, height: 2992 };
  };

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
    dispatch: async () => ({ x: 300, y: 2300 }),
    readAndroidScreenSize,
  });

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
    dispatch: async () => ({ x: 320, y: 2200 }),
    readAndroidScreenSize,
  });

  assert.equal(screenSizeReads, 1);
  const recording = sessionStore.get(sessionName)?.recording;
  assert.deepEqual(recording?.touchReferenceFrame, {
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

  let screenSizeReads = 0;
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
    dispatch: async () => ({ x: 300, y: 2300 }),
    readAndroidScreenSize: async () => {
      screenSizeReads += 1;
      return { width: 1344, height: 2992 };
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(screenSizeReads, 0);
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

  let dispatchCalls = 0;
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
    dispatch: async () => {
      dispatchCalls += 1;
      return { x: 300, y: 2300 };
    },
    readAndroidScreenSize: async () => {
      throw new Error('adb unavailable');
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(dispatchCalls, 1);
  const event = sessionStore.get(sessionName)?.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'tap');
  assert.equal(event?.x, 300);
  assert.equal(event?.y, 2300);
  assert.equal(event?.referenceWidth, undefined);
  assert.equal(event?.referenceHeight, undefined);
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
      dispatch: async () => {
        now = 1_650;
        return {
          gestureStartUptimeMs: 5_100,
          gestureEndUptimeMs: 5_180,
        };
      },
    });

    assert.equal(response?.ok, true);
  } finally {
    Date.now = originalNow;
  }

  const stored = sessionStore.get(sessionName);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  assert.equal(result.gestureStartUptimeMs, 5_100);
  assert.equal(result.gestureEndUptimeMs, 5_180);
  assert.equal(stored?.recording?.gestureEvents[0]?.tMs, 570);
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

  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
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
    dispatch: async (_device, command, positionals) => {
      dispatchCalls.push({ command, positionals });
      return { pressed: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.ref, 'e1');
    assert.equal(response.data?.x, 60);
    assert.equal(response.data?.y, 40);
  }
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'press');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['60', '40']);

  const stored = sessionStore.get(sessionName);
  assert.ok(stored);
  assert.equal(stored?.actions.length, 1);
  assert.equal(stored?.actions[0]?.command, 'press');
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  assert.equal(result.ref, 'e1');
  assert.ok(Array.isArray(result.selectorChain));
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

  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'fill',
      positionals: ['@e1', 'hello@example.com'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
    dispatch: async () => ({ filled: true }),
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.filled, true);
    assert.equal(response.data?.x, undefined);
  }

  const stored = sessionStore.get(sessionName);
  assert.ok(stored);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  assert.equal(result.ref, 'e1');
  assert.equal(result.x, 60);
  assert.equal(result.y, 40);
  assert.ok(Array.isArray(result.selectorChain));

  const event = stored?.recording?.gestureEvents[0];
  assert.equal(event?.kind, 'tap');
  assert.equal(event?.x, 60);
  assert.equal(event?.y, 40);
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

  const dispatchCalls: Array<{
    command: string;
    positionals: string[];
    context: Record<string, unknown> | undefined;
  }> = [];
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
    dispatch: async (_device, command, positionals, _out, context) => {
      dispatchCalls.push({
        command,
        positionals,
        context: context as Record<string, unknown> | undefined,
      });
      return { button: 'secondary' };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'press');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['500', '510']);
  assert.equal(dispatchCalls[0]?.context?.clickButton, 'secondary');
  if (response.ok) {
    assert.equal(response.data?.button, 'secondary');
    assert.equal(response.data?.ref, 'e1');
  }

  const stored = sessionStore.get(sessionName);
  assert.ok(stored);
  assert.equal(stored?.actions[0]?.command, 'click');
  assert.equal(stored?.actions[0]?.flags.clickButton, 'secondary');
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
    dispatch: async () => {
      throw new Error('dispatch should not be called for unsupported middle click');
    },
  });

  assert.ok(response);
  assert.equal(response.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'UNSUPPORTED_OPERATION');
    assert.match(response.error.message, /middle is not supported/i);
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
        // Simulate malformed persisted bounds from older/stale snapshot state.
        rect: { x: 20, y: 40, width: Number.NaN, height: 40 },
        enabled: true,
        hittable: true,
      },
    ]),
    createdAt: Date.now(),
    backend: 'android',
  };
  sessionStore.set(sessionName, session);

  const pressCalls: Array<{ command: string; positionals: string[] }> = [];
  let snapshotCalls = 0;
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
    dispatch: async (_device, command, positionals) => {
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
      pressCalls.push({ command, positionals });
      return { pressed: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(snapshotCalls, 1);
  assert.equal(pressCalls.length, 1);
  assert.equal(pressCalls[0]?.command, 'press');
  assert.deepEqual(pressCalls[0]?.positionals, ['70', '60']);
  if (response.ok) {
    assert.equal(response.data?.x, 70);
    assert.equal(response.data?.y, 60);
    assert.equal(response.data?.ref, 'e1');
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

  const pressCalls: Array<{ command: string; positionals: string[] }> = [];
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
    dispatch: async (_device, command, positionals) => {
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
      pressCalls.push({ command, positionals });
      return { pressed: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(pressCalls.length, 1);
  assert.equal(pressCalls[0]?.command, 'press');
  assert.deepEqual(pressCalls[0]?.positionals, ['140', '220']);
  if (response.ok) {
    assert.equal(response.data?.x, 140);
    assert.equal(response.data?.y, 220);
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

  const fillCalls: Array<{ command: string; positionals: string[] }> = [];
  let snapshotCalls = 0;
  const response = await handleInteractionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'fill',
      positionals: ['@e1', 'hello@example.com'],
      flags: {},
    },
    sessionName,
    sessionStore,
    contextFromFlags,
    dispatch: async (_device, command, positionals) => {
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
      fillCalls.push({ command, positionals });
      return { filled: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(snapshotCalls, 1);
  assert.equal(fillCalls.length, 1);
  assert.equal(fillCalls[0]?.command, 'fill');
  assert.deepEqual(fillCalls[0]?.positionals, ['70', '60', 'hello@example.com']);

  const stored = sessionStore.get(sessionName);
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  assert.equal(result.ref, 'e1');
  assert.equal(result.x, 70);
  assert.equal(result.y, 60);
});

test('press coordinates does not treat extra trailing args as selector', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
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
    dispatch: async (_device, command, positionals) => {
      dispatchCalls.push({ command, positionals });
      return { ok: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'press');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['100', '200']);
  assert.equal(sessionStore.get(sessionName)?.actions.length, 1);
});

test('scrollintoview @ref dispatches geometry-based swipe series', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
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
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  const dispatchCalls: Array<{
    command: string;
    positionals: string[];
    context: Record<string, unknown> | undefined;
  }> = [];
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
    dispatch: async (_device, command, positionals, _out, context) => {
      dispatchCalls.push({
        command,
        positionals,
        context: context as Record<string, unknown> | undefined,
      });
      return { ok: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchCalls.length, 1);
  assert.equal(dispatchCalls[0]?.command, 'swipe');
  assert.equal(dispatchCalls[0]?.positionals.length, 5);
  assert.equal(dispatchCalls[0]?.context?.pattern, 'one-way');
  assert.equal(dispatchCalls[0]?.context?.pauseMs, 0);
  assert.equal(typeof dispatchCalls[0]?.context?.count, 'number');
  assert.ok((dispatchCalls[0]?.context?.count as number) > 1);

  const stored = sessionStore.get(sessionName);
  assert.ok(stored);
  assert.equal(stored?.actions.length, 1);
  assert.equal(stored?.actions[0]?.command, 'scrollintoview');
  const result = (stored?.actions[0]?.result ?? {}) as Record<string, unknown>;
  assert.equal(result.ref, 'e2');
});

test('scrollintoview @ref returns immediately when target is already in viewport safe band', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
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
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);

  const dispatchCalls: Array<{ command: string }> = [];
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
    dispatch: async (_device, command) => {
      dispatchCalls.push({ command });
      return { ok: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchCalls.length, 0);
  if (response.ok) {
    assert.equal(response.data?.attempts, 0);
    assert.equal(response.data?.alreadyVisible, true);
  }
});

test('scrollintoview @ref does not run post-scroll verification snapshot', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const session = makeSession(sessionName);
  session.snapshot = {
    nodes: attachRefs([
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
    ]),
    createdAt: Date.now(),
    backend: 'xctest',
  };
  sessionStore.set(sessionName, session);
  let snapshotCallCount = 0;

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
    dispatch: async (_device, command) => {
      if (command === 'snapshot') {
        snapshotCallCount += 1;
        return {
          nodes: [
            { index: 0, type: 'Application', rect: { x: 0, y: 0, width: 390, height: 844 } },
            {
              index: 1,
              type: 'XCUIElementTypeStaticText',
              label: 'Far item',
              rect: { x: 20, y: 2600, width: 120, height: 40 },
            },
          ],
          backend: 'xctest',
        };
      }
      return { ok: true };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(snapshotCallCount, 0);
});

test('is visible captures one snapshot before evaluating selector predicate', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, makeSession(sessionName));

  let snapshotCallCount = 0;
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
    dispatch: async (_device, command) => {
      if (command === 'snapshot') {
        snapshotCallCount += 1;
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
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(snapshotCallCount, 1);
  if (response.ok) {
    assert.equal(response.data?.predicate, 'visible');
    assert.equal(response.data?.pass, true);
    assert.equal(response.data?.selector, 'id=auth_continue');
  }
});

test('is visible passes for list text that inherits viewport visibility from an ancestor', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'visible-list-item';
  sessionStore.set(sessionName, makeSession(sessionName));

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
    dispatch: async (_device, command) => {
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
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.predicate, 'visible');
    assert.equal(response.data?.pass, true);
    assert.equal(response.data?.selector, 'label=\"Trip ideas\"');
  }
});

test('is visible fails for nodes outside the current viewport', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'visible-offscreen';
  sessionStore.set(sessionName, makeSession(sessionName));

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
    dispatch: async (_device, command) => {
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
    },
  });

  assert.ok(response);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error?.code, 'COMMAND_FAILED');
    assert.match(response.error?.message ?? '', /actual=\{"visible":false/);
  }
});
