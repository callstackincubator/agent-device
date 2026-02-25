import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-trigger-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
    appName: 'ExampleApp',
    appBundleId: 'com.example.app',
  };
}

const invoke = async (_req: DaemonRequest): Promise<DaemonResponse> => {
  return { ok: false, error: { code: 'INVALID_ARGS', message: 'invoke should not be called in trigger tests' } };
};

test('trigger-app-event requires active session or explicit device selector', async () => {
  const sessionStore = makeStore();
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
  assert.ok(response);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /active session or an explicit device selector/i);
  }
});

test('trigger-app-event supports explicit selector without active session', async () => {
  const sessionStore = makeStore();
  let dispatchCalled = false;

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
    ensureReady: async () => {},
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    dispatch: async (device, command, positionals) => {
      dispatchCalled = true;
      assert.equal(device.platform, 'android');
      assert.equal(command, 'trigger-app-event');
      assert.deepEqual(positionals, ['screenshot_taken']);
      return { event: 'screenshot_taken', eventUrl: 'myapp://agent-device/event?name=screenshot_taken' };
    },
  });

  assert.equal(dispatchCalled, true);
  assert.ok(response);
  assert.equal(response.ok, true);
});

test('trigger command records action and refreshes session app bundle context', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  sessionStore.set('default', session);

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'trigger-screenshot-notification',
      positionals: [],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    ensureReady: async () => {},
    dispatch: async () => {
      return {
        event: 'screenshot_taken',
        eventUrl: 'com.updated.app',
      };
    },
    resolveAndroidPackageForOpen: async () => 'com.updated.app',
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  const nextSession = sessionStore.get('default');
  assert.ok(nextSession);
  assert.equal(nextSession?.appBundleId, 'com.updated.app');
  assert.equal(nextSession?.actions.length, 1);
  assert.equal(nextSession?.actions[0]?.command, 'trigger-app-event');
  assert.deepEqual(nextSession?.actions[0]?.positionals, ['screenshot_taken']);
});

test('trigger aliases are normalized to trigger-app-event before dispatch', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  }));

  let dispatchedCommand = '';
  let dispatchedPositionals: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'trigger-memory-warning',
      positionals: [],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    ensureReady: async () => {},
    dispatch: async (_device, command, positionals) => {
      dispatchedCommand = command;
      dispatchedPositionals = positionals;
      return { event: 'memory_warning', eventUrl: 'myapp://agent-device/event?name=memory_warning' };
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  assert.equal(dispatchedCommand, 'trigger-app-event');
  assert.deepEqual(dispatchedPositionals, ['memory_warning']);
});

test('trigger aliases reject unexpected positional arguments', async () => {
  const sessionStore = makeStore();
  sessionStore.set('default', makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  }));

  await assert.rejects(
    () => handleSessionCommands({
      req: {
        token: 't',
        session: 'default',
        command: 'trigger-screenshot',
        positionals: ['extra'],
        flags: {},
      },
      sessionName: 'default',
      logPath: '/tmp/daemon.log',
      sessionStore,
      invoke,
      ensureReady: async () => {},
    }),
    (error: unknown) =>
      error instanceof Error
      && 'code' in error
      && (error as { code?: string }).code === 'INVALID_ARGS'
      && /does not accept positional arguments/i.test(error.message),
  );
});
