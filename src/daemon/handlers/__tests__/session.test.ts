import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import { AppError } from '../../../utils/errors.ts';

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

test('batch executes steps sequentially and returns structured results', async () => {
  const sessionStore = makeSessionStore();
  const seenCommands: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        platform: 'ios',
        udid: 'sim-1',
        out: '/tmp/batch-artifact.json',
        batchSteps: [
          { command: 'open', positionals: ['settings'] },
          { command: 'wait', positionals: ['100'] },
        ],
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (stepReq) => {
      seenCommands.push(stepReq.command);
      assert.equal(stepReq.flags?.platform, 'ios');
      assert.equal(stepReq.flags?.udid, 'sim-1');
      assert.equal(stepReq.flags?.out, '/tmp/batch-artifact.json');
      return { ok: true, data: { command: stepReq.command } };
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(seenCommands, ['open', 'wait']);
  if (response && response.ok) {
    assert.equal(response.data?.total, 2);
    assert.equal(response.data?.executed, 2);
    assert.ok(Array.isArray(response.data?.results));
  }
});

test('batch stops on first failing step with partial results', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        batchSteps: [
          { command: 'open', positionals: ['settings'] },
          { command: 'click', positionals: ['@e1'] },
        ],
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (stepReq) => {
      if (stepReq.command === 'click') {
        return {
          ok: false,
          error: {
            code: 'COMMAND_FAILED',
            message: 'missing target',
            hint: 'refresh selector',
            diagnosticId: 'diag-step-2',
            logPath: '/tmp/diag-step-2.ndjson',
          },
        };
      }
      return { ok: true, data: {} };
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'COMMAND_FAILED');
    assert.match(response.error.message, /Batch failed at step 2/);
    assert.equal(response.error.details?.step, 2);
    assert.equal(response.error.details?.executed, 1);
    assert.equal(response.error.hint, 'refresh selector');
    assert.equal(response.error.diagnosticId, 'diag-step-2');
    assert.equal(response.error.logPath, '/tmp/diag-step-2.ndjson');
    const partial = response.error.details?.partialResults;
    assert.ok(Array.isArray(partial));
    assert.equal(partial.length, 1);
  }
});

test('batch rejects nested replay and batch commands', async () => {
  const sessionStore = makeSessionStore();
  const nestedReplay = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        batchSteps: [{ command: 'replay', positionals: ['./flow.ad'] }],
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(nestedReplay);
  assert.equal(nestedReplay?.ok, false);
  if (nestedReplay && !nestedReplay.ok) {
    assert.equal(nestedReplay.error.code, 'INVALID_ARGS');
  }

  const nestedBatch = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        batchSteps: [{ command: 'batch', positionals: [] }],
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(nestedBatch);
  assert.equal(nestedBatch?.ok, false);
  if (nestedBatch && !nestedBatch.ok) {
    assert.equal(nestedBatch.error.code, 'INVALID_ARGS');
  }
});

test('batch enforces max step guard', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        batchMaxSteps: 1,
        batchSteps: [
          { command: 'open', positionals: ['settings'] },
          { command: 'wait', positionals: ['100'] },
        ],
      },
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
    assert.match(response.error.message, /max allowed is 1/);
  }
});

test('batch step flags override parent selector flags', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        platform: 'ios',
        batchSteps: [
          {
            command: 'open',
            positionals: ['settings'],
            flags: { platform: 'android' },
          },
        ],
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (stepReq) => {
      assert.equal(stepReq.flags?.platform, 'android');
      return { ok: true, data: {} };
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
});

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
  assert.equal(ensureCalls, 0);
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

test('boot --headless launches Android emulator when no running device matches', async () => {
  const sessionStore = makeSessionStore();
  const ensured: string[] = [];
  const launchCalls: Array<{ avdName: string; serial?: string; headless?: boolean }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'android', device: 'Pixel_9_Pro_XL', headless: true },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async (device) => {
      ensured.push(device.id);
    },
    resolveTargetDevice: async () => {
      throw new AppError('DEVICE_NOT_FOUND', 'No devices found');
    },
    ensureAndroidEmulatorBoot: async ({ avdName, serial, headless }) => {
      launchCalls.push({ avdName, serial, headless });
      return {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel_9_Pro_XL',
        kind: 'emulator',
        target: 'mobile',
        booted: true,
      };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(launchCalls, [{ avdName: 'Pixel_9_Pro_XL', serial: undefined, headless: true }]);
  assert.deepEqual(ensured, ['emulator-5554']);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.id, 'emulator-5554');
    assert.equal(response.data?.device, 'Pixel_9_Pro_XL');
  }
});

test('boot launches Android emulator with GUI when no running device matches', async () => {
  const sessionStore = makeSessionStore();
  const launchCalls: Array<{ avdName: string; serial?: string; headless?: boolean }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'android', device: 'Pixel_9_Pro_XL' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => {
      throw new AppError('DEVICE_NOT_FOUND', 'No devices found');
    },
    ensureAndroidEmulatorBoot: async ({ avdName, serial, headless }) => {
      launchCalls.push({ avdName, serial, headless });
      return {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel_9_Pro_XL',
        kind: 'emulator',
        target: 'mobile',
        booted: true,
      };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(launchCalls, [{ avdName: 'Pixel_9_Pro_XL', serial: undefined, headless: false }]);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.id, 'emulator-5554');
    assert.equal(response.data?.device, 'Pixel_9_Pro_XL');
  }
});

test('boot --headless requires avd selector when device cannot be resolved', async () => {
  const sessionStore = makeSessionStore();
  let bootCalled = false;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'android', serial: 'emulator-5554', headless: true },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => {
      throw new AppError('DEVICE_NOT_FOUND', 'No devices found');
    },
    ensureAndroidEmulatorBoot: async () => {
      bootCalled = true;
      throw new Error('unexpected');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  assert.equal(bootCalled, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /boot --headless requires --device <avd-name>/);
  }
});

test('boot --headless rejects non-Android selectors', async () => {
  const sessionStore = makeSessionStore();
  let resolved = false;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'ios', device: 'iPhone 17 Pro', headless: true },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => {
      resolved = true;
      throw new Error('unexpected resolve');
    },
    ensureAndroidEmulatorBoot: async () => {
      throw new Error('unexpected emulator launch');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  assert.equal(resolved, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /headless is supported only for Android emulators/i);
  }
});

test('boot keeps --target validation when emulator is fallback-launched', async () => {
  const sessionStore = makeSessionStore();
  let ensured = false;
  const launchCalls: Array<{ avdName: string; serial?: string; headless?: boolean }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'android', target: 'tv', device: 'Pixel_9_Pro_XL' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {
      ensured = true;
    },
    resolveTargetDevice: async () => {
      throw new AppError('DEVICE_NOT_FOUND', 'No Android TV devices found');
    },
    ensureAndroidEmulatorBoot: async ({ avdName, serial, headless }) => {
      launchCalls.push({ avdName, serial, headless });
      return {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel_9_Pro_XL',
        kind: 'emulator',
        target: 'mobile',
        booted: true,
      };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  assert.equal(ensured, false);
  assert.deepEqual(launchCalls, [{ avdName: 'Pixel_9_Pro_XL', serial: undefined, headless: false }]);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'DEVICE_NOT_FOUND');
    assert.match(response.error.message, /matching --target tv/i);
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

test('clipboard requires an active session or explicit device selector', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'clipboard',
      positionals: ['read'],
      flags: {},
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
    assert.match(response.error.message, /clipboard requires an active session or an explicit device selector/i);
  }
});

test('clipboard read uses active session device', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim-session';
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
      command: 'clipboard',
      positionals: ['read'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    dispatch: async (device, command, positionals) => {
      assert.equal(device.id, 'sim-1');
      assert.equal(command, 'clipboard');
      assert.deepEqual(positionals, ['read']);
      return { action: 'read', text: 'otp-123456' };
    },
    resolveTargetDevice: async () => {
      throw new Error('resolveTargetDevice should not run');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'ios');
    assert.equal(response.data?.action, 'read');
    assert.equal(response.data?.text, 'otp-123456');
  }
});

test('clipboard write supports explicit selector without active session', async () => {
  const sessionStore = makeSessionStore();
  const selectedDevice: SessionState['device'] = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel Emulator',
    kind: 'emulator',
    booted: true,
  };

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'clipboard',
      positionals: ['write', 'hello', 'clipboard'],
      flags: { platform: 'android', serial: 'emulator-5554' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => selectedDevice,
    dispatch: async (device, command, positionals) => {
      assert.equal(device.id, 'emulator-5554');
      assert.equal(command, 'clipboard');
      assert.deepEqual(positionals, ['write', 'hello', 'clipboard']);
      return { action: 'write', textLength: 15 };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.action, 'write');
    assert.equal(response.data?.textLength, 15);
  }
});

test('clipboard rejects unsupported iOS physical devices', async () => {
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

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'clipboard',
      positionals: ['read'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    dispatch: async () => {
      throw new Error('dispatch should not run for unsupported targets');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'UNSUPPORTED_OPERATION');
    assert.match(response.error.message, /clipboard is not supported on this device/i);
  }
});

test('perf requires an active session', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'perf',
      positionals: [],
      flags: {},
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
  }
});

test('perf returns startup samples captured from open actions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'perf-session';
  const measuredAt = new Date('2026-02-24T10:00:00.000Z').toISOString();
  const session = makeSession(sessionName, {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone 16',
    kind: 'simulator',
    booted: true,
  });
  session.actions.push({
    ts: Date.now(),
    command: 'open',
    positionals: ['Settings'],
    flags: {},
    result: {
      startup: {
        durationMs: 184,
        measuredAt,
        method: 'open-command-roundtrip',
        appTarget: 'Settings',
        appBundleId: 'com.apple.Preferences',
      },
    },
  });
  sessionStore.set(sessionName, session);

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'perf',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    const startup = (response.data?.metrics as any)?.startup;
    assert.equal(startup?.available, true);
    assert.equal(startup?.lastDurationMs, 184);
    assert.equal(startup?.lastMeasuredAt, measuredAt);
    assert.equal(startup?.method, 'open-command-roundtrip');
    assert.equal(startup?.sampleCount, 1);
    assert.equal(Array.isArray(startup?.samples), true);
  }
});

test('perf reports startup metric as unavailable when no sample exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'perf-session-empty';
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

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'perf',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    const startup = (response.data?.metrics as any)?.startup;
    assert.equal(startup?.available, false);
    assert.match(String(startup?.reason ?? ''), /no startup sample captured yet/i);
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

test('open app on existing Android session resolves and stores package id', async () => {
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
      appName: 'Old App',
    },
  );

  let dispatchedContext: Record<string, unknown> | undefined;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['RNCLI83'],
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
    resolveAndroidPackageForOpen: async () => 'org.reactjs.native.example.RNCLI83',
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'org.reactjs.native.example.RNCLI83');
  assert.equal(updated?.appName, 'RNCLI83');
  assert.equal(dispatchedContext?.appBundleId, 'org.reactjs.native.example.RNCLI83');
});

test('open intent target on existing Android session clears stale package context', async () => {
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
    resolveAndroidPackageForOpen: async () => undefined,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, undefined);
  assert.equal(updated?.appName, 'settings');
  assert.equal(dispatchedContext?.appBundleId, undefined);
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

test('close on iOS session with recording stops runner session before delete', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-session';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'ios-device-1',
        name: 'My iPhone',
        kind: 'device',
        booted: true,
      }),
      recording: {
        platform: 'ios-device-runner',
        outPath: '/tmp/device-recording.mp4',
        remotePath: 'tmp/device-recording.mp4',
      },
    },
  );

  const stopCalls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    stopIosRunner: async (deviceId) => {
      stopCalls.push(deviceId);
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(stopCalls, ['ios-device-1']);
  assert.equal(sessionStore.get(sessionName), undefined);
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

test('replay resolves relative script path against request cwd', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-cwd-'));
  const replayDir = path.join(replayRoot, 'workflows');
  fs.mkdirSync(replayDir, { recursive: true });
  fs.writeFileSync(path.join(replayDir, 'flow.ad'), 'open "Settings"\n');

  const invoked: DaemonRequest[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'replay',
      positionals: ['workflows/flow.ad'],
      flags: {},
      meta: { cwd: replayRoot },
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
  assert.equal(invoked[0]?.command, 'open');
  assert.deepEqual(invoked[0]?.positionals, ['Settings']);
});

test('replay parses press series flags and passes them to invoke', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-press-series-'));
  const replayPath = path.join(replayRoot, 'press-series.ad');
  fs.writeFileSync(replayPath, 'press 201 545 --count 5 --interval-ms 1 --hold-ms 2 --jitter-px 3 --double-tap\n');

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
  assert.equal(invoked[0]?.flags?.doubleTap, true);
});

test('replay inherits parent device selectors for each invoked step', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-parent-selectors-'));
  const replayPath = path.join(replayRoot, 'selectors.ad');
  fs.writeFileSync(replayPath, 'open "com.whoop.iphone"\n');

  const invoked: DaemonRequest[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'replay',
      positionals: [replayPath],
      flags: {
        platform: 'ios',
        device: 'thymikee-iphone',
        udid: '00008150-001849640CF8401C',
      },
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
  assert.equal(invoked[0]?.flags?.platform, 'ios');
  assert.equal(invoked[0]?.flags?.device, 'thymikee-iphone');
  assert.equal(invoked[0]?.flags?.udid, '00008150-001849640CF8401C');
});

test('logs requires an active session', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'logs',
      positionals: ['path'],
      flags: {},
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
  }
});

test('logs path returns path and active flag when session exists', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok && response.data) {
    assert.equal(typeof response.data.path, 'string');
    assert.ok((response.data.path as string).endsWith('app.log'));
    assert.equal(response.data.active, false);
    assert.equal(response.data.backend, 'ios-simulator');
    assert.equal(typeof response.data.hint, 'string');
  }
});

test('logs rejects invalid action', async () => {
  const sessionStore = makeSessionStore();
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
      command: 'logs',
      positionals: ['invalid'],
      flags: {},
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
    assert.match(response.error.message, /path, start, stop, doctor, mark, or clear/);
  }
});

test('logs start requires app session (appBundleId)', async () => {
  const sessionStore = makeSessionStore();
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
      command: 'logs',
      positionals: ['start'],
      flags: {},
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
    assert.match(response.error.message, /app session|open first/i);
  }
});

test('logs stop requires active app log stream', async () => {
  const sessionStore = makeSessionStore();
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
      command: 'logs',
      positionals: ['stop'],
      flags: {},
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
    assert.match(response.error.message, /no app log stream/i);
  }
});

test('logs start stores session app log state on success', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel',
        kind: 'emulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
    },
  );
  let startCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['start'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    appLogOps: {
      start: async (_device, _bundleId, _outPath) => {
        startCalls += 1;
        return {
          backend: 'android',
          startedAt: 123,
          getState: () => 'active' as const,
          stop: async () => {},
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      stop: async () => {},
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(startCalls, 1);
  const session = sessionStore.get(sessionName);
  assert.ok(session?.appLog);
  assert.equal(session?.appLog?.getState(), 'active');
  assert.equal(session?.appLog?.backend, 'android');
  assert.equal(session?.appLog?.startedAt, 123);
});

test('logs stop clears active session app log state', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel',
        kind: 'emulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
      appLog: {
        platform: 'android',
        backend: 'android',
        outPath: '/tmp/app.log',
        startedAt: Date.now(),
        getState: () => 'active',
        stop: async () => {},
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      },
    },
  );
  let stopCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['stop'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    appLogOps: {
      start: async () => {
        throw new Error('should not be called');
      },
      stop: async () => {
        stopCalls += 1;
      },
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(stopCalls, 1);
  const session = sessionStore.get(sessionName);
  assert.equal(session?.appLog, undefined);
});

test('close auto-stops active app log stream', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel',
        kind: 'emulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
      appLog: {
        platform: 'android',
        backend: 'android',
        outPath: '/tmp/app.log',
        startedAt: Date.now(),
        getState: () => 'active',
        stop: async () => {},
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      },
    },
  );
  let stopCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    appLogOps: {
      start: async () => {
        throw new Error('should not be called');
      },
      stop: async () => {
        stopCalls += 1;
      },
    },
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(stopCalls, 1);
  assert.equal(sessionStore.get(sessionName), undefined);
});

test('logs mark appends marker and returns path', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Simulator',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
    },
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['mark', 'checkpoint'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.marked, true);
    const outPath = String(response.data?.path ?? '');
    assert.match(fs.readFileSync(outPath, 'utf8'), /checkpoint/);
  }
});

test('logs clear truncates log file and removes rotated files', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Simulator',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
    },
  );
  const outPath = sessionStore.resolveAppLogPath(sessionName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, 'before-clear');
  fs.writeFileSync(`${outPath}.1`, 'older');

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['clear'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.path, outPath);
    assert.equal(response.data?.cleared, true);
  }
  assert.equal(fs.readFileSync(outPath, 'utf8'), '');
  assert.equal(fs.existsSync(`${outPath}.1`), false);
});

test('logs clear requires stream to be stopped first', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel',
        kind: 'emulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
      appLog: {
        platform: 'android',
        backend: 'android',
        outPath: '/tmp/app.log',
        startedAt: Date.now(),
        getState: () => 'active',
        stop: async () => {},
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      },
    },
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['clear'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /logs stop/i);
  }
});

test('logs --restart is only supported with logs clear', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Simulator',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
    },
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['path'],
      flags: { restart: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /only supported with logs clear/i);
  }
});

test('logs clear --restart stops active stream, clears logs, and restarts stream', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  const outPath = sessionStore.resolveAppLogPath(sessionName);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, 'before-restart');
  fs.writeFileSync(`${outPath}.1`, 'older');
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel',
        kind: 'emulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
      appLog: {
        platform: 'android',
        backend: 'android',
        outPath,
        startedAt: Date.now(),
        getState: () => 'active',
        stop: async () => {},
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      },
    },
  );
  let stopCalls = 0;
  let startCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['clear'],
      flags: { restart: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    appLogOps: {
      start: async () => {
        startCalls += 1;
        return {
          backend: 'android',
          startedAt: 321,
          getState: () => 'active' as const,
          stop: async () => {},
          wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
        };
      },
      stop: async () => {
        stopCalls += 1;
      },
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.path, outPath);
    assert.equal(response.data?.cleared, true);
    assert.equal(response.data?.restarted, true);
  }
  assert.equal(stopCalls, 1);
  assert.equal(startCalls, 1);
  assert.equal(fs.readFileSync(outPath, 'utf8'), '');
  assert.equal(fs.existsSync(`${outPath}.1`), false);
  const session = sessionStore.get(sessionName);
  assert.ok(session?.appLog);
  assert.equal(session?.appLog?.startedAt, 321);
});

test('logs clear --restart requires app session bundle id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['clear'],
      flags: { restart: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /app session|open <app>/i);
  }
});

test('logs doctor returns check payload', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'ios',
        id: 'sim-1',
        name: 'iPhone Simulator',
        kind: 'simulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
    },
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'logs',
      positionals: ['doctor'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(typeof response.data?.checks, 'object');
    assert.equal(Array.isArray(response.data?.notes), true);
  }
});

test('network requires an active session', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'network',
      positionals: ['dump'],
      flags: {},
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
  }
});

test('network dump returns recent parsed HTTP entries', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    {
      ...makeSession(sessionName, {
        platform: 'android',
        id: 'emulator-5554',
        name: 'Pixel',
        kind: 'emulator',
        booted: true,
      }),
      appBundleId: 'com.example.app',
    },
  );
  const appLogPath = sessionStore.resolveAppLogPath(sessionName);
  fs.mkdirSync(path.dirname(appLogPath), { recursive: true });
  fs.writeFileSync(
    appLogPath,
    [
      '2026-02-24T10:00:00Z GET https://api.example.com/v1/profile status=200',
      '2026-02-24T10:00:01Z POST https://api.example.com/v1/login statusCode=401 headers={\"x-id\":\"abc\"} requestBody={\"email\":\"test@example.com\"} responseBody={\"error\":\"bad_credentials\"}',
    ].join('\n'),
    'utf8',
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'network',
      positionals: ['dump', '10', 'all'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.path, appLogPath);
    assert.equal(response.data?.include, 'all');
    assert.equal(response.data?.active, false);
    assert.equal(response.data?.backend, 'android');
    const entries = Array.isArray(response.data?.entries) ? response.data.entries : [];
    assert.equal(entries.length, 2);
    const latest = entries[0] as Record<string, unknown>;
    assert.equal(latest.method, 'POST');
    assert.equal(latest.url, 'https://api.example.com/v1/login');
    assert.equal(latest.status, 401);
    assert.equal(typeof latest.headers, 'string');
    assert.equal(typeof latest.requestBody, 'string');
    assert.equal(typeof latest.responseBody, 'string');
  }
});

test('network dump validates include mode and limit', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );

  const invalidLimit = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'network',
      positionals: ['dump', '0'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(invalidLimit);
  assert.equal(invalidLimit?.ok, false);
  if (invalidLimit && !invalidLimit.ok) {
    assert.equal(invalidLimit.error.code, 'INVALID_ARGS');
    assert.match(invalidLimit.error.message, /1\.\.200/);
  }

  const invalidMode = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'network',
      positionals: ['dump', '10', 'verbose'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.ok(invalidMode);
  assert.equal(invalidMode?.ok, false);
  if (invalidMode && !invalidMode.ok) {
    assert.equal(invalidMode.error.code, 'INVALID_ARGS');
    assert.match(invalidMode.error.message, /summary, headers, body, all/);
  }
});
