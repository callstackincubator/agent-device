import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import {
  createAgentDevice,
  createMemorySessionStore,
  createLocalArtifactAdapter,
  commands as rootCommands,
  assertBackendCapabilityAllowed,
  localCommandPolicy,
  restrictedCommandPolicy,
  selector as rootSelector,
  type AgentDevice,
  type CommandSessionStore,
} from '../index.ts';
import {
  BACKEND_CAPABILITY_NAMES,
  hasBackendCapability,
  type AgentDeviceBackend,
} from '../backend.ts';
import {
  commandCatalog,
  commands,
  createCommandRouter,
  type ScreenshotCommandOptions,
} from '../commands/index.ts';
import type { ArtifactAdapter, FileInputRef, FileOutputRef } from '../io.ts';
import {
  commandConformanceSuites,
  runCommandConformance,
  type CommandConformanceTarget,
} from '../testing/conformance.ts';

const backend = {
  platform: 'ios',
  captureScreenshot: async () => {},
  typeText: async () => {},
} satisfies AgentDeviceBackend;

const artifacts = {
  resolveInput: async (ref: FileInputRef) => ({
    path: ref.kind === 'path' ? ref.path : `/tmp/upload-${ref.id}`,
  }),
  reserveOutput: async (ref: FileOutputRef | undefined, options) => ({
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

const sessions = {
  get: () => undefined,
  set: () => {},
} satisfies CommandSessionStore;

test('package root exposes command runtime skeleton', async () => {
  const device: AgentDevice = createAgentDevice({
    backend,
    artifacts,
  });

  assert.equal(device.backend.platform, 'ios');
  assert.equal(device.policy.allowLocalInputPaths, false);
  assert.equal(typeof device.capture.screenshot, 'function');
  assert.equal(typeof device.interactions.click, 'function');
  assert.equal('apps' in device, false);
  const result = await device.capture.screenshot({});
  assert.equal(result.path, '/tmp/path.png');
});

test('runtime screenshot command reserves output and calls backend primitive', async () => {
  let captured:
    | {
        path: string;
        fullscreen?: boolean;
        surface?: string;
      }
    | undefined;
  const device = createAgentDevice({
    backend: {
      ...backend,
      captureScreenshot: async (_context, path, options) => {
        captured = {
          path,
          fullscreen: options?.fullscreen,
          surface: options?.surface,
        };
      },
    },
    artifacts,
    sessions,
    policy: localCommandPolicy(),
  });

  const result = await device.capture.screenshot({
    out: { kind: 'path', path: '/tmp/screen.png' },
    fullscreen: true,
    surface: 'menubar',
  });

  assert.deepEqual(captured, {
    path: '/tmp/screen.png',
    fullscreen: true,
    surface: 'menubar',
  });
  assert.deepEqual(result, {
    path: '/tmp/screen.png',
    message: 'Saved screenshot: /tmp/screen.png',
  });
});

test('runtime screenshot command cleans reserved output when publish fails', async () => {
  let cleanupCalled = false;
  const device = createAgentDevice({
    backend,
    artifacts: {
      ...artifacts,
      reserveOutput: async (ref: FileOutputRef | undefined, options) => ({
        path: ref?.kind === 'path' ? ref.path : `/tmp/${options.field}${options.ext}`,
        visibility: options.visibility ?? 'client-visible',
        publish: async () => {
          throw new Error('publish failed');
        },
        cleanup: async () => {
          cleanupCalled = true;
        },
      }),
    },
    sessions,
    policy: localCommandPolicy(),
  });

  await assert.rejects(
    () => device.capture.screenshot({ out: { kind: 'path', path: '/tmp/screen.png' } }),
    /publish failed/,
  );

  assert.equal(cleanupCalled, true);
});

test('public runtime policy helpers expose local and restricted defaults', async () => {
  assert.equal(typeof createLocalArtifactAdapter, 'function');
  assert.equal(rootCommands.capture.screenshot, commands.capture.screenshot);
  assert.deepEqual(rootSelector('label=Continue'), {
    kind: 'selector',
    selector: 'label=Continue',
  });
  assert.equal(localCommandPolicy().allowLocalInputPaths, true);
  assert.equal(localCommandPolicy().allowLocalOutputPaths, true);
  assert.equal(restrictedCommandPolicy().allowLocalInputPaths, false);
  assert.equal(restrictedCommandPolicy({ allowLocalInputPaths: true }).allowLocalInputPaths, true);
  const store = createMemorySessionStore([{ name: 'default' }]);
  assert.equal((await store.get('default'))?.name, 'default');
});

test('local artifact adapter marks command outputs and temp files by visibility', async () => {
  const adapter = createLocalArtifactAdapter();
  const output = await adapter.reserveOutput(undefined, {
    field: 'path',
    ext: '.png',
    visibility: 'client-visible',
  });
  const temp = await adapter.createTempFile({
    prefix: 'agent-device-test',
    ext: '.txt',
  });

  assert.equal(output.visibility, 'client-visible');
  assert.equal(temp.visibility, 'internal');

  await output.cleanup?.();
  await temp.cleanup();
});

test('local artifact adapter can constrain explicit local paths to a root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-local-root-'));
  try {
    const adapter = createLocalArtifactAdapter({ cwd: root, rootDir: root });

    assert.deepEqual(
      await adapter.resolveInput({ kind: 'path', path: 'input.png' }, { usage: 'test' }),
      {
        path: path.join(root, 'input.png'),
      },
    );
    await assert.rejects(
      () => adapter.resolveInput({ kind: 'path', path: '../outside.png' }, { usage: 'test' }),
      /outside the artifact adapter root/,
    );
    await assert.rejects(
      () =>
        adapter.reserveOutput(
          { kind: 'path', path: path.join(path.dirname(root), 'outside.png') },
          { field: 'path', ext: '.png' },
        ),
      /outside the artifact adapter root/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('named backend capabilities require backend support and policy allowance', () => {
  const supportedRuntime = createAgentDevice({
    backend: {
      platform: 'android',
      capabilities: ['android.shell'],
      escapeHatches: {
        androidShell: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
    },
    artifacts,
    policy: restrictedCommandPolicy({ allowNamedBackendCapabilities: ['android.shell'] }),
  });

  assert.doesNotThrow(() => assertBackendCapabilityAllowed(supportedRuntime, 'android.shell'));

  const policyBlockedRuntime = createAgentDevice({
    backend: {
      platform: 'android',
      capabilities: ['android.shell'],
      escapeHatches: {
        androidShell: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      },
    },
    artifacts,
  });

  assert.throws(
    () => assertBackendCapabilityAllowed(policyBlockedRuntime, 'android.shell'),
    /not allowed by command policy/,
  );

  assert.throws(
    () => assertBackendCapabilityAllowed(supportedRuntime, 'ios.runnerCommand'),
    /not supported by this backend/,
  );

  const missingMethodRuntime = createAgentDevice({
    backend: { platform: 'android', capabilities: ['android.shell'] },
    artifacts,
    policy: restrictedCommandPolicy({ allowNamedBackendCapabilities: ['android.shell'] }),
  });

  assert.throws(
    () => assertBackendCapabilityAllowed(missingMethodRuntime, 'android.shell'),
    /does not implement its escape hatch method/,
  );
});

test('memory session store does not expose mutable record references', async () => {
  const store = createMemorySessionStore([
    {
      name: 'default',
      appName: 'Demo',
      snapshot: {
        nodes: [{ ref: 'e1', index: 0, depth: 0, label: 'Initial' }],
        createdAt: 1,
      },
    },
  ]);
  const record = await store.get('default');
  assert.equal(record?.appName, 'Demo');

  if (record) {
    record.appName = 'Mutated';
    if (record.snapshot) record.snapshot.nodes[0]!.label = 'Mutated';
  }

  assert.equal((await store.get('default'))?.appName, 'Demo');
  assert.equal((await store.get('default'))?.snapshot?.nodes[0]?.label, 'Initial');

  const next = {
    name: 'default',
    snapshot: {
      nodes: [{ ref: 'e1', index: 0, depth: 0, label: 'Stored' }],
      createdAt: 2,
    },
  };
  await store.set(next);
  next.snapshot.nodes[0]!.label = 'Mutated after set';

  assert.equal((await store.get('default'))?.snapshot?.nodes[0]?.label, 'Stored');
  const list = await store.list?.();
  if (list?.[0]?.snapshot) list[0].snapshot.nodes[0]!.label = 'Mutated from list';
  assert.equal((await store.get('default'))?.snapshot?.nodes[0]?.label, 'Stored');
});

test('runtime commands work with async command session stores', async () => {
  const records = new Map<string, Awaited<ReturnType<CommandSessionStore['get']>>>();
  records.set('default', { name: 'default' });
  const asyncStore = {
    get: async (name) => records.get(name),
    set: async (record) => {
      records.set(record.name, record);
    },
  } satisfies CommandSessionStore;
  const device = createAgentDevice({
    backend: {
      platform: 'ios',
      captureSnapshot: async () => ({
        snapshot: {
          nodes: [{ ref: 'e1', index: 0, depth: 0, label: 'Ready' }],
          createdAt: 1,
        },
      }),
    },
    artifacts,
    sessions: asyncStore,
    policy: localCommandPolicy(),
  });

  const result = await device.capture.snapshot({ session: 'default' });

  assert.equal(result.nodes[0]?.label, 'Ready');
  assert.equal(records.get('default')?.snapshot?.nodes[0]?.label, 'Ready');
});

test('public backend, commands, io, and conformance subpaths are importable', () => {
  const options = {
    out: { kind: 'path', path: '/tmp/screen.png' },
  } satisfies ScreenshotCommandOptions;
  const target = {
    name: 'fake',
    createRuntime: () =>
      createAgentDevice({
        backend,
        artifacts,
        sessions,
      }),
  } satisfies CommandConformanceTarget;

  assert.equal(BACKEND_CAPABILITY_NAMES.includes('android.shell'), true);
  assert.equal(hasBackendCapability(backend, 'android.shell'), false);
  assert.equal(
    hasBackendCapability({ platform: 'android', capabilities: ['android.shell'] }, 'android.shell'),
    true,
  );
  assert.equal(options.out.kind, 'path');
  assert.equal(typeof commands.capture.screenshot, 'function');
  assert.equal(typeof commands.capture.diffScreenshot, 'function');
  assert.equal(typeof commands.capture.snapshot, 'function');
  assert.equal(typeof commands.capture.diffSnapshot, 'function');
  assert.equal(typeof commands.selectors.find, 'function');
  assert.equal(typeof commands.selectors.get, 'function');
  assert.equal(typeof commands.selectors.getText, 'function');
  assert.equal(typeof commands.selectors.is, 'function');
  assert.equal(typeof commands.selectors.isVisible, 'function');
  assert.equal(typeof commands.selectors.wait, 'function');
  assert.equal(typeof commands.selectors.waitForText, 'function');
  assert.equal(typeof commands.interactions.click, 'function');
  assert.equal(typeof commands.interactions.press, 'function');
  assert.equal(typeof commands.interactions.fill, 'function');
  assert.equal(typeof commands.interactions.typeText, 'function');
  assert.equal(
    commandCatalog.some((entry) => entry.command === 'click' && entry.status === 'implemented'),
    true,
  );
  assert.equal(commandConformanceSuites.length, 3);
  assert.equal(typeof runCommandConformance, 'function');
  assert.equal(target.name, 'fake');
});

test('command router dispatches implemented runtime commands and normalizes errors', async () => {
  const router = createCommandRouter({
    createRuntime: () =>
      createAgentDevice({
        backend,
        artifacts,
        sessions,
      }),
  });

  const ok = await router.dispatch({
    command: 'capture.screenshot',
    options: {},
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && 'path' in ok.data ? ok.data.path : undefined, '/tmp/path.png');

  const failure = await router.dispatch({
    command: 'capture.diffScreenshot',
    options: {
      baseline: { kind: 'path', path: '/tmp/baseline.png' },
    },
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.ok ? undefined : failure.error.code, 'INVALID_ARGS');

  const unsupportedInteraction = await router.dispatch({
    command: 'interactions.click',
    options: {
      target: { kind: 'point', x: 1, y: 2 },
    },
  });
  assert.equal(unsupportedInteraction.ok, false);
  assert.equal(
    unsupportedInteraction.ok ? undefined : unsupportedInteraction.error.code,
    'UNSUPPORTED_OPERATION',
  );

  const typed = await router.dispatch({
    command: 'interactions.typeText',
    options: {
      text: 'hello',
    },
  });
  assert.equal(typed.ok, true);
  assert.equal(typed.ok && 'text' in typed.data ? typed.data.text : undefined, 'hello');

  const planned = await router.dispatch({
    command: 'alert',
    options: {},
  } as never);
  assert.equal(planned.ok, false);
  assert.equal(planned.ok ? undefined : planned.error.code, 'NOT_IMPLEMENTED');
});
