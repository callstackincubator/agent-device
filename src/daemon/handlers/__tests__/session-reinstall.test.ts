import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-reinstall-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

const invoke = async (_req: DaemonRequest): Promise<DaemonResponse> => {
  return { ok: false, error: { code: 'INVALID_ARGS', message: 'invoke should not be called in reinstall tests' } };
};

test('reinstall requires active session or explicit device selector', async () => {
  const sessionStore = makeStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', '/tmp/app.apk'],
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

test('reinstall validates required args before device operations', async () => {
  const sessionStore = makeStore();
  sessionStore.set(
    'default',
    makeSession('default', {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone',
      kind: 'simulator',
      booted: true,
    }),
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app'],
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
    assert.match(response.error.message, /reinstall <app> <path-to-app-binary>/i);
  }
});

test('reinstall reports unsupported operation on iOS physical devices', async () => {
  const sessionStore = makeStore();
  sessionStore.set(
    'default',
    makeSession('default', {
      platform: 'ios',
      id: 'device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
  );
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-reinstall-binary-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', appPath],
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
    assert.equal(response.error.code, 'UNSUPPORTED_OPERATION');
    assert.match(response.error.message, /reinstall is not supported/i);
  }
});

test('reinstall succeeds on active iOS simulator session and records action', async () => {
  const sessionStore = makeStore();
  const session = makeSession('default', {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone',
    kind: 'simulator',
    booted: true,
  });
  sessionStore.set('default', session);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-reinstall-success-ios-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    reinstallOps: {
      ios: async (_device, app, pathToBinary) => {
        assert.equal(app, 'com.example.app');
        assert.equal(pathToBinary, appPath);
        return { bundleId: 'com.example.app' };
      },
      android: async () => {
        throw new Error('unexpected android reinstall');
      },
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.platform, 'ios');
    assert.equal(response.data?.appId, 'com.example.app');
    assert.equal(response.data?.bundleId, 'com.example.app');
    assert.equal(response.data?.appPath, appPath);
  }
  assert.equal(session.actions.length, 1);
  assert.equal(session.actions[0]?.command, 'reinstall');
});

test('reinstall succeeds on active Android session with normalized appId', async () => {
  const sessionStore = makeStore();
  sessionStore.set(
    'default',
    makeSession('default', {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
  );
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-reinstall-success-android-'));
  const appPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(appPath, 'placeholder');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'reinstall',
      positionals: ['com.example.app', appPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
    invoke,
    reinstallOps: {
      ios: async () => {
        throw new Error('unexpected ios reinstall');
      },
      android: async (_device, app, pathToBinary) => {
        assert.equal(app, 'com.example.app');
        assert.equal(pathToBinary, appPath);
        return { package: 'com.example.app' };
      },
    },
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.appId, 'com.example.app');
    assert.equal(response.data?.package, 'com.example.app');
    assert.equal(response.data?.appPath, appPath);
  }
});
