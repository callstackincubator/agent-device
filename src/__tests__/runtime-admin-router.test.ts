import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AgentDeviceBackend, BackendInstallSource } from '../backend.ts';
import type { ArtifactAdapter, FileInputRef } from '../io.ts';
import { createAgentDevice, localCommandPolicy, restrictedCommandPolicy } from '../runtime.ts';
import { createCommandRouter } from '../commands/index.ts';

const artifacts = {
  resolveInput: async (ref: FileInputRef) => ({
    path: ref.kind === 'path' ? ref.path : `/tmp/uploaded/${ref.id}.app`,
    cleanup: ref.kind === 'uploadedArtifact' ? async () => {} : undefined,
  }),
  reserveOutput: async (ref, options) => ({
    path: ref?.kind === 'path' ? ref.path : `/tmp/${options.field}${options.ext}`,
    visibility: options.visibility ?? 'client-visible',
    publish: async () => undefined,
  }),
  createTempFile: async (options) => ({
    path: `/tmp/${options.prefix}${options.ext}`,
    visibility: 'internal',
    cleanup: async () => {},
  }),
} satisfies ArtifactAdapter;

test('admin runtime commands call typed backend primitives', async () => {
  const calls: string[] = [];
  let installSource: BackendInstallSource | undefined;
  const device = createAgentDevice({
    backend: createAdminBackend(calls, (source) => {
      installSource = source;
    }),
    artifacts,
    policy: localCommandPolicy(),
  });

  const devices = await device.admin.devices({ filter: { platform: 'ios' } });
  assert.equal(devices.kind, 'adminDevices');
  assert.equal(devices.devices[0]?.id, 'SIM-1');

  const boot = await device.admin.boot({ target: { id: 'SIM-1' } });
  assert.equal(boot.kind, 'deviceBooted');

  const simulator = await device.admin.ensureSimulator({
    device: 'iPhone 16',
    runtime: 'iOS 18',
    boot: true,
  });
  assert.equal(simulator.udid, 'SIM-1');

  const installed = await device.admin.install({
    app: 'com.example.app',
    source: { kind: 'path', path: '/tmp/Example.app' },
  });
  assert.equal(installed.kind, 'appInstalled');
  assert.deepEqual(installSource, { kind: 'path', path: '/tmp/Example.app' });

  const reinstalled = await device.admin.reinstall({
    app: 'com.example.app',
    source: { kind: 'url', url: 'https://example.test/Example.app.zip' },
  });
  assert.equal(reinstalled.kind, 'appReinstalled');

  const installedFromSource = await device.admin.installFromSource({
    source: { kind: 'url', url: 'https://example.test/Other.app.zip' },
  });
  assert.equal(installedFromSource.kind, 'appInstalledFromSource');

  assert.deepEqual(calls, [
    'listDevices',
    'bootDevice',
    'ensureSimulator',
    'installApp',
    'reinstallApp',
    'installApp',
  ]);
});

test('admin install blocks local paths under restricted policy but accepts uploaded artifacts', async () => {
  let sourceSeen: BackendInstallSource | undefined;
  const device = createAgentDevice({
    backend: createAdminBackend([], (source) => {
      sourceSeen = source;
    }),
    artifacts,
    policy: restrictedCommandPolicy(),
  });

  await assert.rejects(
    () =>
      device.admin.install({
        app: 'com.example.app',
        source: { kind: 'path', path: '/tmp/Example.app' },
      }),
    /Local source paths are not allowed/,
  );

  await device.admin.install({
    app: 'com.example.app',
    source: { kind: 'uploadedArtifact', id: 'artifact-1' },
  });
  assert.deepEqual(sourceSeen, { kind: 'path', path: '/tmp/uploaded/artifact-1.app' });
});

test('router batch preserves per-step failures and enforces per-command policy', async () => {
  const router = createCommandRouter({
    createRuntime: () =>
      createAgentDevice({
        backend: {
          platform: 'ios',
          openApp: async () => {},
          installApp: async () => ({ bundleId: 'com.example.app' }),
        },
        artifacts,
        policy: restrictedCommandPolicy(),
      }),
  });

  const response = await router.dispatch({
    command: 'batch',
    options: {
      steps: [
        { command: 'apps.open', options: { app: 'com.example.app' } },
        {
          command: 'admin.install',
          options: { app: 'com.example.app', source: { kind: 'path', path: '/tmp/app.zip' } },
        },
        { command: 'apps.open', options: { app: 'com.example.other' } },
      ],
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.ok && isResultKind(response.data, 'batch') ? response.data.executed : 0, 2);
  assert.equal(response.ok && isResultKind(response.data, 'batch') ? response.data.failed : 0, 1);
  const failed =
    response.ok && isResultKind(response.data, 'batch') ? response.data.results[1] : null;
  assert.equal(failed?.ok, false);
  assert.equal(failed?.ok === false ? failed.error.code : undefined, 'INVALID_ARGS');

  const nested = await router.dispatch({
    command: 'batch',
    options: {
      steps: [{ command: 'batch', options: { steps: [] } }],
    },
  });
  assert.equal(nested.ok, false);
  assert.equal(nested.ok ? undefined : nested.error.code, 'INVALID_ARGS');
});

test('router batch can continue after failure and inherits command context', async () => {
  const sessionsSeen: unknown[] = [];
  const appsOpened: string[] = [];
  const router = createCommandRouter({
    createRuntime: (request) => {
      sessionsSeen.push(request.options?.session);
      return createAgentDevice({
        backend: {
          platform: 'ios',
          openApp: async (_context, target) => {
            if (target.app === 'bad') throw new Error('open failed');
            if (target.app) appsOpened.push(target.app);
          },
        },
        artifacts,
        policy: restrictedCommandPolicy(),
      });
    },
  });

  const response = await router.dispatch({
    command: 'batch',
    options: {
      session: 'parent-session',
      stopOnError: false,
      maxSteps: 2,
      steps: [
        { command: 'apps.open', options: { app: 'bad' } },
        { command: 'apps.open', options: { app: 'good' } },
      ],
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.ok && isResultKind(response.data, 'batch') ? response.data.executed : 0, 2);
  assert.equal(response.ok && isResultKind(response.data, 'batch') ? response.data.failed : 0, 1);
  assert.deepEqual(appsOpened, ['good']);
  assert.deepEqual(sessionsSeen, ['parent-session', 'parent-session']);
});

test('record and trace runtime commands call typed backend lifecycle primitives', async () => {
  const calls: unknown[] = [];
  const device = createAgentDevice({
    backend: {
      platform: 'ios',
      startRecording: async (_context, options) => {
        calls.push({ command: 'startRecording', options });
        return { path: options?.outPath ?? '/tmp/recording.mp4' };
      },
      stopTrace: async (_context, options) => {
        calls.push({ command: 'stopTrace', options });
        return { outPath: options?.outPath ?? '/tmp/trace.log' };
      },
    },
    artifacts,
    policy: localCommandPolicy(),
  });

  const recording = await device.recording.record({
    action: 'start',
    out: { kind: 'path', path: '/tmp/out.mp4' },
    fps: 30,
    quality: 7,
    hideTouches: true,
  });
  assert.equal(recording.kind, 'recordingStarted');

  const trace = await device.recording.trace({
    action: 'stop',
    out: { kind: 'path', path: '/tmp/out.trace' },
  });
  assert.equal(trace.kind, 'traceStopped');

  assert.deepEqual(calls, [
    {
      command: 'startRecording',
      options: { outPath: '/tmp/out.mp4', fps: 30, quality: 7, showTouches: false },
    },
    { command: 'stopTrace', options: { outPath: '/tmp/out.trace' } },
  ]);
});

test('record output paths are policy-gated', async () => {
  const device = createAgentDevice({
    backend: {
      platform: 'ios',
      startRecording: async () => ({ path: '/tmp/recording.mp4' }),
    },
    artifacts,
    policy: restrictedCommandPolicy(),
  });

  await assert.rejects(
    () =>
      device.recording.record({
        action: 'start',
        out: { kind: 'path', path: '/tmp/out.mp4' },
      }),
    /Local output paths are not allowed/,
  );
});

test('record keeps successful reserved outputs available after publish', async () => {
  let cleanupCalled = false;
  const device = createAgentDevice({
    backend: {
      platform: 'ios',
      startRecording: async (_context, options) => ({ path: options?.outPath }),
    },
    artifacts: {
      ...artifacts,
      reserveOutput: async (_ref, options) => ({
        path: `/tmp/${options.field}${options.ext}`,
        visibility: options.visibility ?? 'client-visible',
        publish: async () => ({
          kind: 'artifact',
          field: options.field,
          artifactId: 'recording-1',
          fileName: 'recording.mp4',
        }),
        cleanup: async () => {
          cleanupCalled = true;
        },
      }),
    },
    policy: restrictedCommandPolicy(),
  });

  const result = await device.recording.record({
    action: 'start',
    out: { kind: 'downloadableArtifact', fileName: 'recording.mp4' },
  });

  assert.equal(result.artifact?.kind, 'artifact');
  assert.equal(cleanupCalled, false);
});

test('router replay and test stay planned until phase 7 migration is complete', async () => {
  const router = createCommandRouter({
    createRuntime: () =>
      createAgentDevice({
        backend: { platform: 'ios' },
        artifacts,
        policy: restrictedCommandPolicy(),
      }),
  });

  const replay = await router.dispatch({
    command: 'replay',
    options: { steps: [{ command: 'apps.open', options: { app: 'com.example.app' } }] },
  } as never);
  assert.equal(replay.ok, false);
  assert.equal(replay.ok ? undefined : replay.error.code, 'NOT_IMPLEMENTED');

  const suite = await router.dispatch({
    command: 'test',
    options: {
      tests: [{ name: 'opens app', steps: [{ command: 'apps.open', options: { app: 'suite' } }] }],
    },
  } as never);
  assert.equal(suite.ok, false);
  assert.equal(suite.ok ? undefined : suite.error.code, 'NOT_IMPLEMENTED');
});

function isResultKind<TKind extends string>(
  value: unknown,
  kind: TKind,
): value is { kind: TKind } & Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && (value as { kind?: unknown }).kind === kind);
}

function createAdminBackend(
  calls: string[],
  onInstallSource?: (source: BackendInstallSource) => void,
): AgentDeviceBackend {
  return {
    platform: 'ios',
    listDevices: async () => {
      calls.push('listDevices');
      return [{ id: 'SIM-1', name: 'iPhone 16', platform: 'ios', kind: 'simulator' }];
    },
    bootDevice: async () => {
      calls.push('bootDevice');
    },
    ensureSimulator: async (_context, options) => {
      calls.push('ensureSimulator');
      return {
        udid: 'SIM-1',
        device: options.device,
        runtime: options.runtime ?? 'iOS 18',
        created: false,
        booted: true,
      };
    },
    installApp: async (_context, target) => {
      calls.push('installApp');
      onInstallSource?.(target.source);
      return { bundleId: target.app ?? 'com.example.app' };
    },
    reinstallApp: async (_context, target) => {
      calls.push('reinstallApp');
      onInstallSource?.(target.source);
      return { bundleId: target.app ?? 'com.example.app' };
    },
  };
}
