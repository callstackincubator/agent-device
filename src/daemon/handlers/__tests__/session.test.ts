import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-handler-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

const noopInvoke = async (_req: DaemonRequest): Promise<DaemonResponse> => ({ ok: true, data: {} });

test('boot requires session or explicit selector', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: {},
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
  }
});

test('boot succeeds for iOS physical devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
  );
  let ensureCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'boot',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {
      ensureCalls += 1;
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(ensureCalls, 1);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'ios');
    assert.equal(response.data?.booted, true);
  }
});

test('boot succeeds for supported device in session', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    }),
  );
  let ensureCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'boot',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {
      ensureCalls += 1;
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(ensureCalls, 1);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.booted, true);
  }
});

test('boot prefers explicit device selector over active session device', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    }),
  );
  const selectedDevice: SessionState['device'] = {
    platform: 'ios',
    id: 'sim-2',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    booted: true,
  };

  const ensured: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'boot',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async (device) => {
      ensured.push(device.id);
    },
    resolveTargetDevice: async () => selectedDevice,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(ensured, ['sim-2']);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'ios');
    assert.equal(response.data?.id, 'sim-2');
  }
});

test('appstate on iOS requires active session on selected device', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone 15',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.apple.Preferences',
      appName: 'Settings',
    },
  );
  const selectedDevice: SessionState['device'] = {
    platform: 'ios',
    id: 'sim-2',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    booted: true,
  };

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => selectedDevice,
    dispatch: async () => {
      throw new Error('snapshot dispatch should not run');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
    assert.match(response.error.message, /requires an active session/i);
  }
});

test('appstate with explicit selector matching session returns session state', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'sim';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone 17 Pro',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.apple.Maps',
      appName: 'Maps',
    },
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    dispatch: async () => {
      throw new Error('snapshot dispatch should not run');
    },
    resolveTargetDevice: async () => {
      throw new Error('resolveTargetDevice should not run');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'ios');
    assert.equal(response.data?.appName, 'Maps');
    assert.equal(response.data?.appBundleId, 'com.apple.Maps');
    assert.equal(response.data?.source, 'session');
  }
});

test('appstate returns session appName when bundle id is unavailable', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'sim';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone 17 Pro',
        kind: 'simulator',
        booted: true,
      }),
      appName: 'Maps',
    },
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    dispatch: async () => {
      throw new Error('snapshot dispatch should not run');
    },
    resolveTargetDevice: async () => {
      throw new Error('resolveTargetDevice should not run');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'ios');
    assert.equal(response.data?.appName, 'Maps');
    assert.equal(response.data?.appBundleId, undefined);
    assert.equal(response.data?.source, 'session');
  }
});

test('appstate fails when iOS session has no tracked app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'sim';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'COMMAND_FAILED');
    assert.match(response.error.message, /no foreground app is tracked/i);
  }
});

test('appstate without session on iOS selector returns SESSION_NOT_FOUND', async () => {
  const sessionStore = makeSessionStore();
  const selectedDevice: SessionState['device'] = {
    platform: 'ios',
    id: 'sim-2',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    booted: true,
  };

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => selectedDevice,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
  }
});

test('appstate with explicit missing session returns SESSION_NOT_FOUND', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'sim',
      command: 'appstate',
      positionals: [],
      flags: { session: 'sim', platform: 'ios', device: 'iPhone 17 Pro' },
    },
    sessionName: 'sim',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
    assert.match(response.error.message, /no active session "sim"/i);
    assert.doesNotMatch(response.error.message, /omit --session/i);
  }
});

test('open URL on existing iOS session clears stale app bundle id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-session';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone 15',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.example.old',
      appName: 'Old App',
    },
  );

  let dispatchedContext: Record<string, unknown> | undefined;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['https://example.com/path'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async (_device, _command, _positionals, _out, context) => {
      dispatchedContext = context as Record<string, unknown> | undefined;
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, undefined);
  assert.equal(updated?.appName, 'https://example.com/path');
  assert.equal(dispatchedContext?.appBundleId, undefined);
});

test('open URL on existing iOS device session preserves app bundle id context', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-session';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'ios-device-1',
        name: 'iPhone Device',
        kind: 'device',
        booted: true,
      }),
      appBundleId: 'com.example.app',
      appName: 'Example App',
    },
  );

  let dispatchedContext: Record<string, unknown> | undefined;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['myapp://item/42'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async (_device, _command, _positionals, _out, context) => {
      dispatchedContext = context as Record<string, unknown> | undefined;
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'com.example.app');
  assert.equal(updated?.appName, 'myapp://item/42');
  assert.equal(dispatchedContext?.appBundleId, 'com.example.app');
});

test('open web URL on iOS device session without active app falls back to Safari', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
  );

  let dispatchedContext: Record<string, unknown> | undefined;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['https://example.com/path'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async (_device, _command, _positionals, _out, context) => {
      dispatchedContext = context as Record<string, unknown> | undefined;
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'com.apple.mobilesafari');
  assert.equal(updated?.appName, 'https://example.com/path');
  assert.equal(dispatchedContext?.appBundleId, 'com.apple.mobilesafari');
});

test('open app and URL on existing iOS device session keeps app context', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-session';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'ios-device-1',
        name: 'iPhone Device',
        kind: 'device',
        booted: true,
      }),
      appBundleId: 'com.example.previous',
      appName: 'Previous App',
    },
  );

  let dispatchedPositionals: string[] | undefined;
  let dispatchedContext: Record<string, unknown> | undefined;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['Settings', 'myapp://screen/to'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async (_device, _command, positionals, _out, context) => {
      dispatchedPositionals = positionals;
      dispatchedContext = context as Record<string, unknown> | undefined;
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'com.apple.Preferences');
  assert.equal(updated?.appName, 'Settings');
  assert.deepEqual(dispatchedPositionals, ['Settings', 'myapp://screen/to']);
  assert.equal(dispatchedContext?.appBundleId, 'com.apple.Preferences');
});

test('open app on existing iOS session resolves and stores bundle id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-session';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone 15',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.example.old',
      appName: 'Old App',
    },
  );

  let dispatchedContext: Record<string, unknown> | undefined;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['settings'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async (_device, _command, _positionals, _out, context) => {
      dispatchedContext = context as Record<string, unknown> | undefined;
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'com.apple.Preferences');
  assert.equal(updated?.appName, 'settings');
  assert.equal(dispatchedContext?.appBundleId, 'com.apple.Preferences');
});

test('open --relaunch closes and reopens active session app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-session';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel Emulator',
        kind: 'emulator',
        booted: true,
      }),
      appName: 'com.example.app',
    },
  );

  const calls: Array<{ command: string; positionals: string[] }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: [],
      flags: { relaunch: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async (_device, command, positionals) => {
      calls.push({ command, positionals });
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { command: 'close', positionals: ['com.example.app'] });
  assert.deepEqual(calls[1], { command: 'open', positionals: ['com.example.app'] });
});

test('open --relaunch rejects URL targets', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['https://example.com/path'],
      flags: { relaunch: true },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /does not support URL targets/i);
  }
});

test('open --relaunch fails without app when no session exists', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: [],
      flags: { relaunch: true },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /requires an app argument/i);
  }
});

test('open on in-use device returns DEVICE_IN_USE before readiness checks', async () => {
  const sessionStore = makeSessionStore();
  sessionStore.set(
    'busy-session',
    makeSession('busy-session', {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
  );

  let ensureReadyCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['settings'],
      flags: { platform: 'ios' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {
      ensureReadyCalls += 1;
    },
    resolveTargetDevice: async () => ({
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'DEVICE_IN_USE');
  }
  assert.equal(ensureReadyCalls, 0);
});

test('replay parses open --relaunch flag and replays open with relaunch semantics', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-relaunch-'));
  const replayPath = path.join(replayRoot, 'relaunch.ad');
  fs.writeFileSync(replayPath, 'open "Settings" --relaunch\n');

  const invoked: DaemonRequest[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'replay',
      positionals: [replayPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (req) => {
      invoked.push(req);
      return { ok: true, data: {} };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.replayed, 1);
  }
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0]?.command, 'open');
  assert.deepEqual(invoked[0]?.positionals, ['Settings']);
  assert.equal(invoked[0]?.flags?.relaunch, true);
});

test('replay parses press series flags and passes them to invoke', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-press-series-'));
  const replayPath = path.join(replayRoot, 'press-series.ad');
  fs.writeFileSync(replayPath, 'press 201 545 --count 5 --interval-ms 1 --hold-ms 2 --jitter-px 3 --tap-batch\n');

  const invoked: DaemonRequest[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'replay',
      positionals: [replayPath],
      flags: {},
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (req) => {
      invoked.push(req);
      return { ok: true, data: {} };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0]?.command, 'press');
  assert.deepEqual(invoked[0]?.positionals, ['201', '545']);
  assert.equal(invoked[0]?.flags?.count, 5);
  assert.equal(invoked[0]?.flags?.intervalMs, 1);
  assert.equal(invoked[0]?.flags?.holdMs, 2);
  assert.equal(invoked[0]?.flags?.jitterPx, 3);
  assert.equal(invoked[0]?.flags?.tapBatch, true);
});
