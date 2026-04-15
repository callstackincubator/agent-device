import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  createAgentDevice,
  createMemorySessionStore,
  createLocalArtifactAdapter,
  commands as rootCommands,
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
import { commandConformanceSuites, type CommandConformanceTarget } from '../testing/conformance.ts';

const backend = {
  platform: 'ios',
  captureScreenshot: async () => {},
} satisfies AgentDeviceBackend;

const artifacts = {
  resolveInput: async (ref: FileInputRef) => ({
    path: ref.kind === 'path' ? ref.path : `/tmp/upload-${ref.id}`,
  }),
  reserveOutput: async (ref: FileOutputRef | undefined, options) => ({
    path: ref?.kind === 'path' ? ref.path : `/tmp/${options.field}${options.ext}`,
    publish: async () => undefined,
  }),
  createTempFile: async (options) => ({
    path: `/tmp/${options.prefix}${options.ext}`,
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

test('memory session store does not expose mutable record references', async () => {
  const store = createMemorySessionStore([{ name: 'default', appName: 'Demo' }]);
  const record = await store.get('default');
  assert.equal(record?.appName, 'Demo');

  if (record) record.appName = 'Mutated';

  assert.equal((await store.get('default'))?.appName, 'Demo');
  assert.deepEqual(await store.list?.(), [{ name: 'default', appName: 'Demo' }]);
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
  assert.equal(
    commandCatalog.some((entry) => entry.command === 'click' && entry.status === 'implemented'),
    true,
  );
  assert.equal(commandConformanceSuites.length, 0);
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
});
