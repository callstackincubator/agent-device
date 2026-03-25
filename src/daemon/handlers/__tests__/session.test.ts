import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSessionCommands } from '../session.ts';
import { retainMaterializedPaths } from '../../materialized-path-registry.ts';
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

function assertInvalidArgsMessage(response: DaemonResponse | null, message: string): void {
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.equal(response.error.message, message);
  }
}

async function withMockedPlatform<T>(platform: NodeJS.Platform, fn: () => Promise<T>): Promise<T> {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

async function withMockedMacOsHelper<T>(script: string, fn: () => Promise<T>): Promise<T> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-macos-helper-test-'));
  const helperPath = path.join(root, 'agent-device-macos-helper');
  fs.writeFileSync(helperPath, script, 'utf8');
  fs.chmodSync(helperPath, 0o755);
  const previous = process.env.AGENT_DEVICE_MACOS_HELPER_BIN;
  process.env.AGENT_DEVICE_MACOS_HELPER_BIN = helperPath;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.AGENT_DEVICE_MACOS_HELPER_BIN;
    else process.env.AGENT_DEVICE_MACOS_HELPER_BIN = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('devices filters Apple-family platform selectors', async () => {
  const sessionStore = makeSessionStore();
  const listAndroidDevices = async () => [
    {
      platform: 'android' as const,
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator' as const,
      target: 'mobile' as const,
      booted: true,
    },
  ];
  const listAppleDevices = async () => [
    {
      platform: 'ios' as const,
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator' as const,
      target: 'mobile' as const,
      booted: true,
    },
    {
      platform: 'macos' as const,
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device' as const,
      target: 'desktop' as const,
      booted: true,
    },
  ];
  const runDevices = async (flags: DaemonRequest['flags']) =>
    handleSessionCommands({
      req: {
        token: 't',
        session: 'default',
        command: 'devices',
        positionals: [],
        flags,
      },
      sessionName: 'default',
      logPath: path.join(os.tmpdir(), 'daemon.log'),
      sessionStore,
      invoke: noopInvoke,
      listAndroidDevices,
      listAppleDevices,
    });

  const macosResponse = await runDevices({ platform: 'macos' });
  assert.ok(macosResponse?.ok);
  if (macosResponse?.ok) {
    const devices = macosResponse.data?.devices as Array<{ platform: string }> | undefined;
    assert.deepEqual(
      devices?.map((device) => device.platform),
      ['macos'],
    );
  }

  const iosResponse = await runDevices({ platform: 'ios' });
  assert.ok(iosResponse?.ok);
  if (iosResponse?.ok) {
    const devices = iosResponse.data?.devices as Array<{ platform: string }> | undefined;
    assert.deepEqual(
      devices?.map((device) => device.platform),
      ['ios'],
    );
  }

  const appleDesktopResponse = await runDevices({ platform: 'apple', target: 'desktop' });
  assert.ok(appleDesktopResponse?.ok);
  if (appleDesktopResponse?.ok) {
    const devices = appleDesktopResponse.data?.devices as Array<{ platform: string }> | undefined;
    assert.deepEqual(
      devices?.map((device) => device.platform),
      ['macos'],
    );
  }
});

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

test('batch step forwards typed runtime payload', async () => {
  const sessionStore = makeSessionStore();
  const seenRuntimes: Array<DaemonRequest['runtime']> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        batchSteps: [
          {
            command: 'open',
            positionals: ['Demo'],
            flags: { platform: 'android' },
            runtime: {
              metroHost: '10.0.0.10',
              metroPort: 8081,
            },
          },
        ],
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (stepReq) => {
      seenRuntimes.push(stepReq.runtime);
      return { ok: true, data: {} };
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(seenRuntimes, [
    {
      metroHost: '10.0.0.10',
      metroPort: 8081,
    },
  ]);
});

test('batch step pins nested requests to the resolved session', async () => {
  const sessionStore = makeSessionStore();
  const seenSessions: Array<{ session: string; flagSession: string | undefined }> = [];

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'batch',
      positionals: [],
      flags: {
        batchSteps: [{ command: 'wait', positionals: ['100'] }],
      },
    },
    sessionName: 'resolved-session',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (stepReq) => {
      seenSessions.push({
        session: stepReq.session,
        flagSession: stepReq.flags?.session,
      });
      return { ok: true, data: {} };
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(seenSessions, [
    {
      session: 'resolved-session',
      flagSession: 'resolved-session',
    },
  ]);
});

test('runtime set/show/clear manages session-scoped runtime hints before open', async () => {
  const sessionStore = makeSessionStore();
  const baseRequest = {
    token: 't',
    session: 'remote-runtime',
  } satisfies Pick<DaemonRequest, 'token' | 'session'>;

  const setResponse = await handleSessionCommands({
    req: {
      ...baseRequest,
      command: 'runtime',
      positionals: ['set'],
      flags: {
        platform: 'android',
        metroHost: '10.0.0.10',
        metroPort: 8081,
        launchUrl: 'myapp://dev-client',
      },
    },
    sessionName: 'remote-runtime',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.equal(setResponse?.ok, true);

  const showResponse = await handleSessionCommands({
    req: {
      ...baseRequest,
      command: 'runtime',
      positionals: ['show'],
      flags: {},
    },
    sessionName: 'remote-runtime',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.equal(showResponse?.ok, true);
  if (showResponse && showResponse.ok) {
    assert.equal(showResponse.data?.configured, true);
    assert.deepEqual(showResponse.data?.runtime, {
      platform: 'android',
      metroHost: '10.0.0.10',
      metroPort: 8081,
      bundleUrl: undefined,
      launchUrl: 'myapp://dev-client',
    });
  }

  const clearResponse = await handleSessionCommands({
    req: {
      ...baseRequest,
      command: 'runtime',
      positionals: ['clear'],
      flags: {},
    },
    sessionName: 'remote-runtime',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.equal(clearResponse?.ok, true);
  assert.equal(sessionStore.getRuntimeHints('remote-runtime'), undefined);
});

test('runtime clear removes applied transport hints for the active app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-clear-active';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
  });
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    appBundleId: 'com.example.demo',
  });

  const clearCalls: Array<{ deviceId: string; appId?: string }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'runtime',
      positionals: ['clear'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    clearRuntimeHints: async ({ device, appId }) => {
      clearCalls.push({ deviceId: device.id, appId });
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(clearCalls, [{ deviceId: 'emulator-5554', appId: 'com.example.demo' }]);
  assert.equal(sessionStore.getRuntimeHints(sessionName), undefined);
});

test('open applies stored runtime launchUrl and reports runtime hints', async () => {
  const sessionStore = makeSessionStore();
  sessionStore.setRuntimeHints('runtime-open', {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    launchUrl: 'myapp://dev-client',
  });
  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
  const runtimeApplyCalls: Array<{ appId?: string; host?: string; port?: number }> = [];
  const callOrder: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'runtime-open',
      command: 'open',
      positionals: ['Demo'],
      flags: { platform: 'android' },
    },
    sessionName: 'runtime-open',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    resolveAndroidPackageForOpen: async () => 'com.example.demo',
    applyRuntimeHints: async ({ appId, runtime }) => {
      callOrder.push('runtime');
      runtimeApplyCalls.push({
        appId,
        host: runtime?.metroHost,
        port: runtime?.metroPort,
      });
    },
    dispatch: async (_device, command, positionals) => {
      callOrder.push(`dispatch:${command}`);
      dispatchCalls.push({ command, positionals });
      return {};
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(callOrder, ['runtime', 'dispatch:open', 'dispatch:open']);
  assert.deepEqual(runtimeApplyCalls, [
    { appId: 'com.example.demo', host: '10.0.0.10', port: 8081 },
  ]);
  assert.deepEqual(dispatchCalls, [
    { command: 'open', positionals: ['Demo'] },
    { command: 'open', positionals: ['myapp://dev-client'] },
  ]);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.target, 'mobile');
    assert.equal(response.data?.device, 'Pixel');
    assert.equal(response.data?.id, 'emulator-5554');
    assert.equal(response.data?.serial, 'emulator-5554');
    assert.deepEqual(response.data?.runtime, {
      platform: 'android',
      metroHost: '10.0.0.10',
      metroPort: 8081,
      launchUrl: 'myapp://dev-client',
    });
  }
});

test('open runtime payload replaces stored session runtime atomically', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-open-inline';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'android',
    metroHost: '127.0.0.1',
    metroPort: 9000,
    launchUrl: 'myapp://stale',
  });

  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
  const runtimeApplyCalls: Array<{
    appId?: string;
    host?: string;
    port?: number;
    launchUrl?: string;
  }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['Demo'],
      flags: { platform: 'android' },
      runtime: {
        metroHost: '10.0.0.10',
        metroPort: 8081,
      },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    resolveAndroidPackageForOpen: async () => 'com.example.demo',
    applyRuntimeHints: async ({ appId, runtime }) => {
      runtimeApplyCalls.push({
        appId,
        host: runtime?.metroHost,
        port: runtime?.metroPort,
        launchUrl: runtime?.launchUrl,
      });
    },
    dispatch: async (_device, command, positionals) => {
      dispatchCalls.push({ command, positionals });
      return {};
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(runtimeApplyCalls, [
    { appId: 'com.example.demo', host: '10.0.0.10', port: 8081, launchUrl: undefined },
  ]);
  assert.deepEqual(dispatchCalls, [{ command: 'open', positionals: ['Demo'] }]);
  assert.deepEqual(sessionStore.getRuntimeHints(sessionName), {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    bundleUrl: undefined,
    launchUrl: undefined,
  });
  assert.deepEqual(
    sessionStore.get(sessionName)?.actions.map((action) => action.command),
    ['open'],
  );
  assert.deepEqual(sessionStore.get(sessionName)?.actions[0]?.runtime, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    bundleUrl: undefined,
    launchUrl: undefined,
  });
  if (response && response.ok) {
    assert.deepEqual(response.data?.runtime, {
      platform: 'android',
      metroHost: '10.0.0.10',
      metroPort: 8081,
      bundleUrl: undefined,
      launchUrl: undefined,
    });
  }
});

test('open runtime payload clears stale applied transport hints before launch', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-open-clear';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
  });
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    appBundleId: 'com.example.demo',
    appName: 'Demo',
  });

  const callOrder: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['Demo'],
      flags: {},
      runtime: {
        launchUrl: 'myapp://fresh',
      },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveAndroidPackageForOpen: async () => 'com.example.demo',
    clearRuntimeHints: async ({ device, appId }) => {
      callOrder.push(`clear:${device.id}:${appId}`);
    },
    applyRuntimeHints: async () => {
      callOrder.push('runtime');
    },
    dispatch: async (_device, command, positionals) => {
      callOrder.push(`dispatch:${command}:${positionals.join('|')}`);
      return {};
    },
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(callOrder, [
    'clear:emulator-5554:com.example.demo',
    'runtime',
    'dispatch:open:Demo',
    'dispatch:open:myapp://fresh',
  ]);
  assert.deepEqual(sessionStore.getRuntimeHints(sessionName), {
    platform: 'android',
    metroHost: undefined,
    metroPort: undefined,
    bundleUrl: undefined,
    launchUrl: 'myapp://fresh',
  });
  if (response && response.ok) {
    assert.deepEqual(response.data?.runtime, {
      platform: 'android',
      metroHost: undefined,
      metroPort: undefined,
      bundleUrl: undefined,
      launchUrl: 'myapp://fresh',
    });
  }
});

test('open runtime payload rejects invalid metro port before app launch', async () => {
  const sessionStore = makeSessionStore();
  let dispatchCalls = 0;

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'runtime-open-invalid-port',
      command: 'open',
      positionals: ['Demo'],
      flags: { platform: 'android' },
      runtime: {
        metroHost: '10.0.0.10',
        metroPort: 70000,
      },
    },
    sessionName: 'runtime-open-invalid-port',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    dispatch: async () => {
      dispatchCalls += 1;
      return {};
    },
  });

  assertInvalidArgsMessage(
    response,
    'Invalid runtime metroPort: 70000. Use an integer between 1 and 65535.',
  );
  assert.equal(dispatchCalls, 0);
});

test('open runtime payload rejects malformed runtime objects without mutating session state', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-open-malformed';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['Demo'],
      flags: { platform: 'android' },
      runtime: 'not-an-object' as unknown as DaemonRequest['runtime'],
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
  });

  assertInvalidArgsMessage(response, 'open runtime must be an object.');
  assert.deepEqual(sessionStore.getRuntimeHints(sessionName), {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
  });
});

test('open runtime payload does not persist replacement when launch fails', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-open-launch-fails';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    launchUrl: 'myapp://stale',
  });

  await assert.rejects(
    async () =>
      await handleSessionCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'open',
          positionals: ['Demo'],
          flags: { platform: 'android' },
          runtime: {
            metroHost: '127.0.0.1',
            metroPort: 9090,
          },
        },
        sessionName,
        logPath: path.join(os.tmpdir(), 'daemon.log'),
        sessionStore,
        invoke: noopInvoke,
        ensureReady: async () => {},
        resolveTargetDevice: async () => ({
          platform: 'android',
          id: 'emulator-5554',
          name: 'Pixel',
          kind: 'emulator',
          booted: true,
        }),
        applyRuntimeHints: async () => {},
        dispatch: async () => {
          throw new AppError('COMMAND_FAILED', 'launch failed');
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'COMMAND_FAILED');
      assert.equal(error.message, 'launch failed');
      return true;
    },
  );

  assert.deepEqual(sessionStore.getRuntimeHints(sessionName), {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    launchUrl: 'myapp://stale',
  });
});

test('close clears applied runtime transport hints before deleting the session', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'runtime-close-active';
  sessionStore.setRuntimeHints(sessionName, {
    platform: 'ios',
    metroHost: '127.0.0.1',
    metroPort: 8081,
  });
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.demo',
  });

  const clearCalls: Array<{ deviceId: string; appId?: string }> = [];
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
    clearRuntimeHints: async ({ device, appId }) => {
      clearCalls.push({ deviceId: device.id, appId });
    },
    stopIosRunner: async () => {},
  });

  assert.equal(response?.ok, true);
  assert.deepEqual(clearCalls, [{ deviceId: 'sim-1', appId: 'com.example.demo' }]);
  assert.equal(sessionStore.get(sessionName), undefined);
  assert.equal(sessionStore.getRuntimeHints(sessionName), undefined);
});

test('close clears retained materialized install paths bound to the session', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'materialized-close-active';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    }),
  });
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-materialized-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Info.plist'), 'plist');
  const retained = await retainMaterializedPaths({
    installablePath: appPath,
    sessionName,
    ttlMs: 60_000,
  });

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
    stopIosRunner: async () => {},
  });

  assert.equal(response?.ok, true);
  assert.equal(sessionStore.get(sessionName), undefined);
  assert.equal(fs.existsSync(retained.installablePath), false);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('release_materialized_paths removes retained install artifacts', async () => {
  const sessionStore = makeSessionStore();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-release-materialized-'));
  const appPath = path.join(tempRoot, 'Sample.app');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(path.join(appPath, 'Info.plist'), 'plist');
  const retained = await retainMaterializedPaths({
    installablePath: appPath,
    ttlMs: 60_000,
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'release_materialized_paths',
      positionals: [],
      flags: {},
      meta: {
        materializationId: retained.materializationId,
      },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.equal(response?.ok, true);
  assert.equal(fs.existsSync(retained.installablePath), false);
  fs.rmSync(tempRoot, { recursive: true, force: true });
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
  assert.deepEqual(launchCalls, [
    { avdName: 'Pixel_9_Pro_XL', serial: undefined, headless: false },
  ]);
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
  assert.deepEqual(launchCalls, [
    { avdName: 'Pixel_9_Pro_XL', serial: undefined, headless: false },
  ]);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'DEVICE_NOT_FOUND');
    assert.match(response.error.message, /matching --target tv/i);
  }
});

test('appstate on iOS requires active session on selected device', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'default';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.apple.Preferences',
    appName: 'Settings',
  });
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.apple.Maps',
    appName: 'Maps',
  });

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
    assert.equal(response.data?.device_udid, 'sim-1');
    assert.equal(response.data?.ios_simulator_device_set, null);
  }
});

test('appstate returns session appName when bundle id is unavailable', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'sim';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    }),
    appName: 'Maps',
  });

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
    assert.equal(response.data?.device_udid, 'sim-1');
    assert.equal(response.data?.ios_simulator_device_set, null);
  }
});

test('appstate on macOS session returns session state', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
    appBundleId: 'com.apple.systempreferences',
    appName: 'System Settings',
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'appstate',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    dispatch: async () => {
      throw new Error('dispatch should not run');
    },
    resolveTargetDevice: async () => {
      throw new Error('resolveTargetDevice should not run');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'macos');
    assert.equal(response.data?.appName, 'System Settings');
    assert.equal(response.data?.appBundleId, 'com.apple.systempreferences');
    assert.equal(response.data?.source, 'session');
    assert.equal(response.data?.surface, 'app');
    assert.equal(response.data?.device_udid, undefined);
    assert.equal(response.data?.ios_simulator_device_set, undefined);
  }
});

test('appstate on macOS desktop surface returns surface state without app bundle id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-desktop';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
    surface: 'desktop',
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'appstate',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    ensureReady: async () => {},
    dispatch: async () => {
      throw new Error('dispatch should not run');
    },
    resolveTargetDevice: async () => {
      throw new Error('resolveTargetDevice should not run');
    },
  });

  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'macos');
    assert.equal(response.data?.appName, 'desktop');
    assert.equal(response.data?.appBundleId, undefined);
    assert.equal(response.data?.surface, 'desktop');
    assert.equal(response.data?.source, 'session');
  }
});

test('apps on macOS uses Apple app listing path', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-apps';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
  );

  let listAppleAppsCalls = 0;
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'apps',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    listAppleApps: async (device, filter) => {
      listAppleAppsCalls += 1;
      assert.equal(device.platform, 'macos');
      assert.equal(filter, 'all');
      return [{ bundleId: 'com.apple.systempreferences', name: 'System Settings' }];
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(listAppleAppsCalls, 1);
  if (response && response.ok) {
    assert.deepEqual(response.data?.apps, ['System Settings (com.apple.systempreferences)']);
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
    assert.match(
      response.error.message,
      /clipboard requires an active session or an explicit device selector/i,
    );
  }
});

test('keyboard requires an active session or explicit device selector', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'keyboard',
      positionals: ['status'],
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
    assert.match(
      response.error.message,
      /keyboard requires an active session or an explicit device selector/i,
    );
  }
});

test('keyboard dismiss supports explicit selector without active session', async () => {
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
      command: 'keyboard',
      positionals: ['dismiss'],
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
      assert.equal(command, 'keyboard');
      assert.deepEqual(positionals, ['dismiss']);
      return { platform: 'android', action: 'dismiss', dismissed: true, visible: false };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.platform, 'android');
    assert.equal(response.data?.action, 'dismiss');
    assert.equal(response.data?.dismissed, true);
    assert.equal(response.data?.visible, false);
  }
});

test('keyboard rejects unsupported iOS simulator devices', async () => {
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
      command: 'keyboard',
      positionals: ['status'],
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
    assert.match(response.error.message, /keyboard is not supported on this device/i);
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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
    dispatch: async (device, command, positionals) => {
      assert.equal(device.id, 'sim-1');
      assert.equal(command, 'clipboard');
      assert.deepEqual(positionals, ['read']);
      return { action: 'read', text: 'otp-123456' };
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.old',
    appName: 'Old App',
  });

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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, undefined);
  assert.equal(updated?.appName, 'https://example.com/path');
  assert.equal(dispatchedContext?.appBundleId, undefined);
});

test('open URL on existing macOS session clears stale app bundle id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'macos',
      id: 'host-mac',
      name: 'Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
    appBundleId: 'com.example.old',
    appName: 'Old App',
  });

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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
    appBundleId: 'com.example.app',
    appName: 'Example App',
  });

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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'iPhone Device',
      kind: 'device',
      booted: true,
    }),
    appBundleId: 'com.example.previous',
    appName: 'Previous App',
  });

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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.old',
    appName: 'Old App',
  });

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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'com.apple.Preferences');
  assert.equal(updated?.appName, 'settings');
  assert.equal(dispatchedContext?.appBundleId, 'com.apple.Preferences');
  if (response && response.ok) {
    assert.equal(response.data?.device_udid, 'sim-1');
    assert.equal(response.data?.ios_simulator_device_set, null);
  }
});

test('open app on existing macOS session resolves and stores bundle id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'macos',
      id: 'host-mac',
      name: 'Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
    appBundleId: 'com.example.old',
    appName: 'Old App',
  });

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
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.appBundleId, 'com.apple.systempreferences');
  assert.equal(updated?.appName, 'settings');
  assert.equal(dispatchedContext?.appBundleId, 'com.apple.systempreferences');
});

test('open on macOS with --surface frontmost-app stores frontmost app state', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      "cat <<'JSON'",
      '{"ok":true,"data":{"bundleId":"com.apple.TextEdit","appName":"TextEdit","pid":123}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-frontmost';
      let dispatchedPositionals: string[] | undefined;
      const response = await handleSessionCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'open',
          positionals: [],
          flags: {
            platform: 'macos',
            surface: 'frontmost-app',
          },
        },
        sessionName,
        logPath: path.join(os.tmpdir(), 'daemon.log'),
        sessionStore,
        invoke: noopInvoke,
        dispatch: async (_device, _command, positionals) => {
          dispatchedPositionals = positionals;
          return {};
        },
        ensureReady: async () => {},
        resolveTargetDevice: async () => ({
          platform: 'macos',
          id: 'host-macos-local',
          name: 'Host Mac',
          kind: 'device',
          target: 'desktop',
          booted: true,
        }),
      });

      assert.equal(response?.ok, true);
      assert.deepEqual(dispatchedPositionals, []);
      const session = sessionStore.get(sessionName);
      assert.equal(session?.surface, 'frontmost-app');
      assert.equal(session?.appBundleId, 'com.apple.TextEdit');
      assert.equal(session?.appName, 'TextEdit');
      if (response && response.ok) {
        assert.equal(response.data?.surface, 'frontmost-app');
        assert.equal(response.data?.appBundleId, 'com.apple.TextEdit');
        assert.equal(response.data?.appName, 'TextEdit');
      }
    },
  );
});

test('open on existing macOS frontmost-app session preserves surface without --surface flag', async () => {
  await withMockedMacOsHelper(
    [
      '#!/bin/sh',
      "cat <<'JSON'",
      '{"ok":true,"data":{"bundleId":"com.apple.TextEdit","appName":"TextEdit","pid":123}}',
      'JSON',
      '',
    ].join('\n'),
    async () => {
      const sessionStore = makeSessionStore();
      const sessionName = 'macos-frontmost-existing';
      sessionStore.set(sessionName, {
        ...makeSession(sessionName, {
          platform: 'macos',
          id: 'host-macos-local',
          name: 'Host Mac',
          kind: 'device',
          target: 'desktop',
          booted: true,
        }),
        surface: 'frontmost-app',
        appBundleId: 'com.apple.TextEdit',
        appName: 'TextEdit',
      });

      const response = await handleSessionCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'open',
          positionals: [],
          flags: {
            platform: 'macos',
          },
        },
        sessionName,
        logPath: path.join(os.tmpdir(), 'daemon.log'),
        sessionStore,
        invoke: noopInvoke,
        dispatch: async (_device, _command, positionals) => {
          assert.deepEqual(positionals, []);
          return {};
        },
        ensureReady: async () => {},
        resolveTargetDevice: async () =>
          sessionStore.get(sessionName)?.device as SessionState['device'],
      });

      assert.equal(response?.ok, true);
      const session = sessionStore.get(sessionName);
      assert.equal(session?.surface, 'frontmost-app');
      assert.equal(session?.appBundleId, 'com.apple.TextEdit');
      assert.equal(session?.appName, 'TextEdit');
      if (response && response.ok) {
        assert.equal(response.data?.surface, 'frontmost-app');
      }
    },
  );
});

test('open on macOS rejects desktop surface until desktop-global backend lands', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-desktop-surface';
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: [],
      flags: {
        platform: 'macos',
        surface: 'desktop' as any,
      },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    dispatch: async () => ({}),
    ensureReady: async () => {},
    resolveTargetDevice: async () => ({
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
  });

  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /not supported yet/i);
    assert.match(response.error.message, /app\|frontmost-app/i);
  }
});

test('open on existing iOS session refreshes unavailable simulator by name', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'stale-sim',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: false,
    }),
    appBundleId: 'com.example.old',
    appName: 'Old App',
  });

  const resolvedDevice: SessionState['device'] = {
    platform: 'ios',
    id: 'fresh-sim',
    name: 'iPhone 17 Pro',
    kind: 'simulator',
    booted: true,
  };
  const selectors: Array<Record<string, unknown>> = [];
  let dispatchedDeviceId: string | undefined;

  const response = await withMockedPlatform('darwin', async () =>
    handleSessionCommands({
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
      dispatch: async (device) => {
        dispatchedDeviceId = device.id;
        return {};
      },
      ensureReady: async () => {},
      resolveTargetDevice: async (flags) => {
        selectors.push({ ...(flags ?? {}) });
        if (flags.udid === 'stale-sim') {
          throw new AppError('DEVICE_NOT_FOUND', 'No Apple device with UDID stale-sim');
        }
        return resolvedDevice;
      },
    }),
  );

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(selectors.length, 2);
  assert.deepEqual(selectors[0], { platform: 'ios', target: undefined, udid: 'stale-sim' });
  assert.deepEqual(selectors[1], { platform: 'ios', target: undefined, device: 'iPhone 17 Pro' });
  assert.equal(dispatchedDeviceId, 'fresh-sim');
  const updated = sessionStore.get(sessionName);
  assert.equal(updated?.device.id, 'fresh-sim');
  if (response && response.ok) {
    assert.equal(response.data?.device_udid, 'fresh-sim');
  }
});

test('open app on existing Android session resolves and stores package id', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    }),
    appName: 'Old App',
  });

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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    }),
    appBundleId: 'com.example.old',
    appName: 'Old App',
  });

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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    }),
    appName: 'com.example.app',
  });

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

test('open --relaunch on iOS stops runner before close/open', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
    appName: 'com.example.app',
  });

  const calls: string[] = [];
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
    stopIosRunner: async () => {
      calls.push('stop-runner');
    },
    dispatch: async (_device, command, positionals) => {
      calls.push(`${command}:${positionals.join(' ')}`);
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(calls, ['stop-runner', 'close:com.example.app', 'open:com.example.app']);
});

test('open --relaunch on iOS without existing session closes then opens target app', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-new-session';

  const calls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'open',
      positionals: ['com.example.app'],
      flags: { relaunch: true, platform: 'ios' },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    resolveTargetDevice: async () => ({
      platform: 'ios',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
    stopIosRunner: async () => {
      calls.push('stop-runner');
    },
    dispatch: async (_device, command, positionals) => {
      calls.push(`${command}:${positionals.join(' ')}`);
      return {};
    },
    ensureReady: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(calls, ['stop-runner', 'close:com.example.app', 'open:com.example.app']);
});

test('open --relaunch on iOS simulator reaches settle path for close and open', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone 16',
      kind: 'simulator',
      booted: true,
    }),
    appName: 'com.example.app',
  });

  const settleCalls: Array<{ deviceId: string; delayMs: number }> = [];
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
    dispatch: async () => ({}),
    stopIosRunner: async () => {},
    ensureReady: async () => {},
    resolveTargetDevice: async () =>
      sessionStore.get(sessionName)?.device as SessionState['device'],
    settleSimulator: async (device, delayMs) => {
      settleCalls.push({ deviceId: device.id, delayMs });
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(settleCalls.length, 2);
  assert.deepEqual(settleCalls[0], { deviceId: 'sim-1', delayMs: 300 });
  assert.deepEqual(settleCalls[1], { deviceId: 'sim-1', delayMs: 300 });
});

test('close on iOS session with recording stops runner session before delete', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-session';
  sessionStore.set(sessionName, {
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
      startedAt: Date.now(),
      showTouches: false,
      gestureEvents: [],
    },
  });

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

test('close <app> on iOS stops runner before app close dispatch and performs final idempotent stop', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-close-session';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
    appName: 'com.example.app',
  });

  const calls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: ['com.example.app'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    stopIosRunner: async () => {
      calls.push('stop-runner');
    },
    dispatch: async (_device, command, positionals) => {
      calls.push(`${command}:${positionals.join(' ')}`);
      return {};
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(calls, ['stop-runner', 'close:com.example.app', 'stop-runner']);
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

test('open --relaunch rejects Android app binary paths', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['/tmp/app-debug.apk'],
      flags: { relaunch: true, platform: 'android' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
  });

  assertInvalidArgsMessage(
    response,
    'Android runtime hints require an installed package name, not "/tmp/app-debug.apk". Install or reinstall the app first, then relaunch by package.',
  );
});

test('open --relaunch rejects bare Android app binary filenames', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['app-debug.apk'],
      flags: { relaunch: true, platform: 'android' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
  });

  assertInvalidArgsMessage(
    response,
    'Android runtime hints require an installed package name, not "app-debug.apk". Install or reinstall the app first, then relaunch by package.',
  );
});

test('open --relaunch allows Android package names ending with apk-like suffix', async () => {
  const sessionStore = makeSessionStore();
  const dispatchCalls: Array<{ command: string; positionals: string[] }> = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['com.example.apk'],
      flags: { relaunch: true, platform: 'android' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    resolveTargetDevice: async () => ({
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    dispatch: async (_device, command, positionals) => {
      dispatchCalls.push({ command, positionals });
      return {};
    },
    ensureReady: async () => {},
    applyRuntimeHints: async () => {},
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(dispatchCalls[0]?.command, 'close');
  assert.deepEqual(dispatchCalls[0]?.positionals, ['com.example.apk']);
  assert.equal(dispatchCalls[1]?.command, 'open');
  assert.deepEqual(dispatchCalls[1]?.positionals, ['com.example.apk']);
});

test('open --relaunch rejects Android app binary paths for active sessions', async () => {
  const sessionStore = makeSessionStore();
  const session = makeSession('default', {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel',
    kind: 'emulator',
    booted: true,
  });
  session.appName = 'com.example.app';
  session.appBundleId = 'com.example.app';
  sessionStore.set('default', session);

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['/tmp/app-debug.apk'],
      flags: { relaunch: true, platform: 'android' },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assertInvalidArgsMessage(
    response,
    'Android runtime hints require an installed package name, not "/tmp/app-debug.apk". Install or reinstall the app first, then relaunch by package.',
  );
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

test('replay parses runtime set flags and replays runtime command', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-runtime-'));
  const replayPath = path.join(replayRoot, 'runtime.ad');
  fs.writeFileSync(
    replayPath,
    'runtime set --platform android --metro-host 10.0.0.10 --metro-port 8081 --launch-url "myapp://dev"\n',
  );
  const invoked: DaemonRequest[] = [];

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'replay',
      positionals: [replayPath],
      flags: {},
      meta: { cwd: replayRoot },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (request) => {
      invoked.push(request);
      return { ok: true, data: {} };
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(invoked[0]?.command, 'runtime');
  assert.deepEqual(invoked[0]?.positionals, ['set']);
  assert.deepEqual(invoked[0]?.flags, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    launchUrl: 'myapp://dev',
  });
});

test('replay parses inline open runtime flags and replays open with runtime payload', async () => {
  const sessionStore = makeSessionStore();
  const replayRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-open-runtime-'));
  const replayPath = path.join(replayRoot, 'runtime-open.ad');
  fs.writeFileSync(
    replayPath,
    'open "Demo" --relaunch --platform android --metro-host 10.0.0.10 --metro-port 8081 --launch-url "myapp://dev"\n',
  );
  const invoked: DaemonRequest[] = [];

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'replay',
      positionals: [replayPath],
      flags: {},
      meta: { cwd: replayRoot },
    },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: async (request) => {
      invoked.push(request);
      return { ok: true, data: {} };
    },
  });

  assert.equal(response?.ok, true);
  assert.equal(invoked[0]?.command, 'open');
  assert.deepEqual(invoked[0]?.positionals, ['Demo']);
  assert.deepEqual(invoked[0]?.flags, { relaunch: true });
  assert.deepEqual(invoked[0]?.runtime, {
    platform: 'android',
    metroHost: '10.0.0.10',
    metroPort: 8081,
    launchUrl: 'myapp://dev',
  });
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
  fs.writeFileSync(
    replayPath,
    'press 201 545 --count 5 --interval-ms 1 --hold-ms 2 --jitter-px 3 --double-tap\n',
  );

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
  const replayRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-device-replay-parent-selectors-'),
  );
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

test('logs path supports macOS desktop sessions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-default';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
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
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.active, false);
    assert.equal(response.data?.backend, 'macos');
    assert.equal(typeof response.data?.path, 'string');
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    appBundleId: 'com.example.app',
  });
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
  sessionStore.set(sessionName, {
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
  });
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
  sessionStore.set(sessionName, {
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
  });
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.app',
  });
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.app',
  });
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
  sessionStore.set(sessionName, {
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
  });

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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.app',
  });
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
  sessionStore.set(sessionName, {
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
  });
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
    appBundleId: 'com.example.app',
  });
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
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    }),
    appBundleId: 'com.example.app',
  });
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

test('network dump supports macOS desktop sessions', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'macos-network';
  sessionStore.set(sessionName, {
    ...makeSession(sessionName, {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
    appBundleId: 'com.apple.systempreferences',
  });
  const appLogPath = sessionStore.resolveAppLogPath(sessionName);
  fs.mkdirSync(path.dirname(appLogPath), { recursive: true });
  fs.writeFileSync(
    appLogPath,
    '2026-02-24T10:00:00Z GET https://example.com/mac status=204',
    'utf8',
  );
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'network',
      positionals: ['dump', '10', 'summary'],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    assert.equal(response.data?.backend, 'macos');
    const entries = Array.isArray(response.data?.entries) ? response.data.entries : [];
    assert.equal(entries.length, 1);
    assert.equal((entries[0] as Record<string, unknown>).url, 'https://example.com/mac');
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

test('session_list includes device_udid and ios_simulator_device_set for iOS sessions', async () => {
  const sessionStore = makeSessionStore();
  sessionStore.set(
    'ios-default',
    makeSession('ios-default', {
      platform: 'ios',
      id: 'ABC-123',
      name: 'iPhone 16',
      kind: 'simulator',
      booted: true,
    }),
  );
  sessionStore.set(
    'ios-scoped',
    makeSession('ios-scoped', {
      platform: 'ios',
      id: 'DEF-456',
      name: 'iPhone 16',
      kind: 'simulator',
      booted: true,
      simulatorSetPath: '/tmp/tenant-a/simulators',
    }),
  );
  sessionStore.set(
    'android-1',
    makeSession('android-1', {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel Emulator',
      kind: 'emulator',
      booted: true,
    }),
  );
  sessionStore.set(
    'macos-1',
    makeSession('macos-1', {
      platform: 'macos',
      id: 'host-macos-local',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: { token: 't', session: 'default', command: 'session_list', positionals: [] },
    sessionName: 'default',
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response && response.ok) {
    const sessions = response.data?.sessions as Array<Record<string, unknown>>;
    assert.ok(Array.isArray(sessions));
    const iosDefault = sessions.find((s) => s.name === 'ios-default');
    assert.equal(iosDefault?.device_udid, 'ABC-123');
    assert.equal(iosDefault?.ios_simulator_device_set, null);
    const iosScoped = sessions.find((s) => s.name === 'ios-scoped');
    assert.equal(iosScoped?.device_udid, 'DEF-456');
    assert.equal(iosScoped?.ios_simulator_device_set, '/tmp/tenant-a/simulators');
    const android = sessions.find((s) => s.name === 'android-1');
    const macos = sessions.find((s) => s.name === 'macos-1');
    assert.equal(android?.device_udid, undefined);
    assert.equal(android?.ios_simulator_device_set, undefined);
    assert.equal(android?.device_id, 'emulator-5554');
    assert.equal(macos?.device_id, 'host-macos-local');
    assert.equal(macos?.device_udid, undefined);
    assert.equal(macos?.ios_simulator_device_set, undefined);
  }
});

test('close --shutdown calls shutdownSimulator for iOS simulator and includes result in response', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-udid-1',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
  );

  const shutdownCalls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    stopIosRunner: async () => {},
    shutdownSimulator: async (device) => {
      shutdownCalls.push(device.id);
      return { success: true, exitCode: 0, stdout: '', stderr: '' };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(shutdownCalls, ['sim-udid-1']);
  assert.equal(sessionStore.get(sessionName), undefined);
  if (response && response.ok) {
    assert.equal(response.data?.session, sessionName);
    assert.deepEqual(response.data?.shutdown, {
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  }
});

test('close --shutdown calls shutdownAndroidEmulator for Android emulator and includes result in response', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel_9_API_35',
      kind: 'emulator',
      booted: true,
    }),
  );

  const shutdownCalls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    shutdownAndroidEmulator: async (device) => {
      shutdownCalls.push(device.id);
      return { success: true, stdout: '', stderr: '', exitCode: 0 };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(shutdownCalls, ['emulator-5554']);
  assert.equal(sessionStore.get(sessionName), undefined);
  if (response && response.ok) {
    assert.equal(response.data?.session, sessionName);
    assert.deepEqual(response.data?.shutdown, {
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  }
});

test('close --shutdown is ignored for non-simulator iOS devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'physical-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
  );

  const shutdownCalls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    stopIosRunner: async () => {},
    shutdownSimulator: async (device) => {
      shutdownCalls.push(device.id);
      return { success: true, exitCode: 0, stdout: '', stderr: '' };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(shutdownCalls, []);
  assert.equal(sessionStore.get(sessionName), undefined);
  if (response && response.ok) {
    assert.equal(response.data?.session, sessionName);
    assert.equal(response.data?.shutdown, undefined);
  }
});

test('close --shutdown is ignored for Android devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-device-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'R5CT123456A',
      name: 'Pixel 9',
      kind: 'device',
      booted: true,
    }),
  );

  const shutdownCalls: string[] = [];
  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    shutdownAndroidEmulator: async (device) => {
      shutdownCalls.push(device.id);
      return { success: true, stdout: '', stderr: '', exitCode: 0 };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(shutdownCalls, []);
  assert.equal(sessionStore.get(sessionName), undefined);
  if (response && response.ok) {
    assert.equal(response.data?.session, sessionName);
    assert.equal(response.data?.shutdown, undefined);
  }
});

test('close without --shutdown does not call shutdownSimulator', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-no-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-udid-2',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
  );

  const shutdownCalls: string[] = [];
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
    stopIosRunner: async () => {},
    shutdownSimulator: async (device) => {
      shutdownCalls.push(device.id);
      return { success: true, exitCode: 0, stdout: '', stderr: '' };
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.deepEqual(shutdownCalls, []);
  if (response && response.ok) {
    assert.equal(response.data?.shutdown, undefined);
  }
});

test('close --shutdown returns success and failure payload when shutdownAndroidEmulator throws', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-shutdown-failure-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5556',
      name: 'Pixel_9_API_35',
      kind: 'emulator',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    shutdownAndroidEmulator: async () => {
      throw new AppError('COMMAND_FAILED', 'adb emu kill failed');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(sessionStore.get(sessionName), undefined);
  if (response && response.ok) {
    const shutdown = response.data?.shutdown as
      | {
          success?: boolean;
          exitCode?: number;
          stdout?: string;
          stderr?: string;
          error?: {
            code?: string;
            message?: string;
          };
        }
      | undefined;
    assert.equal(response.data?.session, sessionName);
    assert.equal(shutdown?.success, false);
    assert.equal(shutdown?.exitCode, -1);
    assert.equal(shutdown?.stdout, '');
    assert.equal(shutdown?.stderr, 'adb emu kill failed');
    assert.equal(shutdown?.error?.code, 'COMMAND_FAILED');
    assert.equal(shutdown?.error?.message, 'adb emu kill failed');
  }
});

test('close --shutdown returns success and failure payload when shutdownSimulator throws', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-shutdown-failure-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-udid-3',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
    stopIosRunner: async () => {},
    shutdownSimulator: async () => {
      throw new AppError('COMMAND_FAILED', 'simctl shutdown failed');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(sessionStore.get(sessionName), undefined);
  if (response && response.ok) {
    const shutdown = response.data?.shutdown as
      | {
          success?: boolean;
          exitCode?: number;
          stdout?: string;
          stderr?: string;
          error?: {
            code?: string;
            message?: string;
          };
        }
      | undefined;
    assert.equal(response.data?.session, sessionName);
    assert.equal(shutdown?.success, false);
    assert.equal(shutdown?.exitCode, -1);
    assert.equal(shutdown?.stdout, '');
    assert.equal(shutdown?.stderr, 'simctl shutdown failed');
    assert.equal(shutdown?.error?.code, 'COMMAND_FAILED');
    assert.equal(shutdown?.error?.message, 'simctl shutdown failed');
  }
});
