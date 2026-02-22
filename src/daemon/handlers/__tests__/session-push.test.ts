import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import type { CommandFlags } from '../../../core/dispatch.ts';

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
  return { ok: false, error: { code: 'INVALID_ARGS', message: 'invoke should not be called in push tests' } };
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
  assert.ok(response);
  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /active session or an explicit device selector/i);
  }
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

  let dispatchCalled = false;
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
    dispatch: async (device, command, positionals) => {
      dispatchCalled = true;
      assert.equal(device.id, 'emulator-5554');
      assert.equal(command, 'push');
      assert.deepEqual(positionals, ['com.example.app', '{"action":"com.example.PUSH"}']);
      return { platform: 'android', package: 'com.example.app', action: 'com.example.PUSH' };
    },
    ensureReady: async () => {},
  });

  assert.equal(dispatchCalled, true);
  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.platform, 'android');
  }
  assert.equal(session.actions.length, 1);
  assert.equal(session.actions[0]?.command, 'push');
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-push-payload-'));
  const payloadPath = path.join(tempRoot, 'payload.json');
  fs.writeFileSync(payloadPath, '{"action":"com.example.PUSH"}\n', 'utf8');

  let pushedPath = '';
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
    dispatch: async (_device, _command, positionals) => {
      pushedPath = positionals[1] ?? '';
      return {};
    },
    ensureReady: async () => {},
  });

  assert.equal(pushedPath, payloadPath);
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
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-push-brace-file-'));
  const payloadPath = path.join(tempRoot, '{payload}.json');
  fs.writeFileSync(payloadPath, '{"action":"com.example.PUSH"}\n', 'utf8');

  let pushedPath = '';
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
    dispatch: async (_device, _command, positionals) => {
      pushedPath = positionals[1] ?? '';
      return {};
    },
    ensureReady: async () => {},
  });

  assert.equal(pushedPath, payloadPath);
});
