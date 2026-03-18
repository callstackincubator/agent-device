import test from 'node:test';
import assert from 'node:assert/strict';
import { tryRunClientBackedCommand } from '../cli-client-commands.ts';
import type { AgentDeviceClient, AppInstallFromSourceOptions } from '../client.ts';
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

function createStubClient(params: {
  installFromSource: AgentDeviceClient['apps']['installFromSource'];
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
