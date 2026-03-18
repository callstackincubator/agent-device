import test from 'node:test';
import assert from 'node:assert/strict';
import { tryRunClientBackedCommand } from '../cli-client-commands.ts';
import type {
  AgentDeviceClient,
  AppInstallFromSourceOptions,
  MetroPrepareOptions,
} from '../client.ts';
import { AppError } from '../utils/errors.ts';

test('install-from-source forwards URL and repeated headers to client.apps.installFromSource', async () => {
  let observed: AppInstallFromSourceOptions | undefined;
  const client = createStubClient({
    installFromSource: async (options) => {
      observed = options;
      return {
        launchTarget: 'com.example.demo',
        packageName: 'com.example.demo',
        identifiers: { appId: 'com.example.demo', package: 'com.example.demo' },
      };
    },
  });

  const handled = await tryRunClientBackedCommand({
    command: 'install-from-source',
    positionals: ['https://example.com/app.apk'],
    flags: {
      json: false,
      help: false,
      version: false,
      platform: 'android',
      header: ['authorization: Bearer token', 'x-build-id: 42'],
      retainPaths: true,
      retentionMs: 60_000,
    },
    client,
  });

  assert.equal(handled, true);
  assert.equal(observed?.platform, 'android');
  assert.equal(observed?.retainPaths, true);
  assert.equal(observed?.retentionMs, 60_000);
  assert.deepEqual(observed?.source, {
    kind: 'url',
    url: 'https://example.com/app.apk',
    headers: {
      authorization: 'Bearer token',
      'x-build-id': '42',
    },
  });
});

test('install-from-source rejects malformed header syntax', async () => {
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected call');
    },
  });

  await assert.rejects(
    () =>
      tryRunClientBackedCommand({
        command: 'install-from-source',
        positionals: ['https://example.com/app.apk'],
        flags: {
          json: false,
          help: false,
          version: false,
          header: ['authorization'],
        },
        client,
      }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('Expected "name:value"'),
  );
});

test('metro prepare forwards normalized options to client.metro.prepare', async () => {
  let observed: MetroPrepareOptions | undefined;
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    prepareMetro: async (options) => {
      observed = options;
      return {
        projectRoot: '/tmp/project',
        kind: 'react-native',
        dependenciesInstalled: false,
        packageManager: null,
        started: false,
        reused: true,
        pid: 0,
        logPath: '/tmp/project/.agent-device/metro.log',
        statusUrl: 'http://127.0.0.1:8081/status',
        runtimeFilePath: null,
        iosRuntime: {
          platform: 'ios',
          bundleUrl: 'https://sandbox.example.test/index.bundle?platform=ios',
        },
        androidRuntime: {
          platform: 'android',
          bundleUrl: 'https://sandbox.example.test/index.bundle?platform=android',
        },
        bridge: null,
      };
    },
  });

  const handled = await tryRunClientBackedCommand({
    command: 'metro',
    positionals: ['prepare'],
    flags: {
      json: false,
      help: false,
      version: false,
      metroProjectRoot: './apps/demo',
      metroPublicBaseUrl: 'https://sandbox.example.test',
      metroProxyBaseUrl: 'https://proxy.example.test',
      metroBearerToken: 'secret',
      metroPreparePort: 9090,
      metroKind: 'expo',
      metroRuntimeFile: './.forfiter/metro-runtime.json',
      metroNoReuseExisting: true,
      metroNoInstallDeps: true,
    },
    client,
  });

  assert.equal(handled, true);
  assert.deepEqual(observed, {
    projectRoot: './apps/demo',
    publicBaseUrl: 'https://sandbox.example.test',
    proxyBaseUrl: 'https://proxy.example.test',
    bearerToken: 'secret',
    port: 9090,
    kind: 'expo',
    runtimeFilePath: './.forfiter/metro-runtime.json',
    reuseExisting: false,
    installDependenciesIfNeeded: false,
    listenHost: undefined,
    statusHost: undefined,
    startupTimeoutMs: undefined,
    probeTimeoutMs: undefined,
  });
});

function createStubClient(params: {
  installFromSource: AgentDeviceClient['apps']['installFromSource'];
  prepareMetro?: AgentDeviceClient['metro']['prepare'];
}): AgentDeviceClient {
  return {
    devices: {
      list: async () => [],
    },
    sessions: {
      list: async () => [],
      close: async () => ({ session: 'default', identifiers: { session: 'default' } }),
    },
    simulators: {
      ensure: async () => ({
        udid: 'sim-1',
        device: 'iPhone 16',
        runtime: 'iOS-18-0',
        created: false,
        booted: true,
        identifiers: {
          deviceId: 'sim-1',
          deviceName: 'iPhone 16',
          udid: 'sim-1',
        },
      }),
    },
    apps: {
      install: async () => ({
        app: 'Demo',
        appPath: '/tmp/Demo.app',
        platform: 'ios',
        identifiers: { appId: 'com.example.demo' },
      }),
      reinstall: async () => ({
        app: 'Demo',
        appPath: '/tmp/Demo.app',
        platform: 'ios',
        identifiers: { appId: 'com.example.demo' },
      }),
      installFromSource: params.installFromSource,
      open: async () => ({
        session: 'default',
        identifiers: { session: 'default' },
      }),
      close: async () => ({
        session: 'default',
        identifiers: { session: 'default' },
      }),
    },
    materializations: {
      release: async (options) => ({
        released: true,
        materializationId: options.materializationId,
        identifiers: { session: options.session ?? 'default' },
      }),
    },
    runtime: {
      set: async () => ({
        session: 'default',
        configured: true,
        identifiers: { session: 'default' },
      }),
      show: async () => ({
        session: 'default',
        configured: false,
        identifiers: { session: 'default' },
      }),
    },
    metro: {
      prepare:
        params.prepareMetro ??
        (async () => ({
          projectRoot: '/tmp/project',
          kind: 'react-native',
          dependenciesInstalled: false,
          packageManager: null,
          started: false,
          reused: true,
          pid: 0,
          logPath: '/tmp/project/.agent-device/metro.log',
          statusUrl: 'http://127.0.0.1:8081/status',
          runtimeFilePath: null,
          iosRuntime: {
            platform: 'ios',
            bundleUrl: 'https://sandbox.example.test/index.bundle?platform=ios',
          },
          androidRuntime: {
            platform: 'android',
            bundleUrl: 'https://sandbox.example.test/index.bundle?platform=android',
          },
          bridge: null,
        })),
    },
    capture: {
      snapshot: async () => ({
        nodes: [],
        truncated: false,
        identifiers: { session: 'default' },
      }),
      screenshot: async () => ({
        path: '/tmp/screenshot.png',
        identifiers: { session: 'default' },
      }),
    },
  };
}
