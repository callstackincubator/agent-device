import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { tryRunClientBackedCommand } from '../cli-client-commands.ts';
import type {
  AgentDeviceClient,
  AppInstallFromSourceOptions,
  AppOpenOptions,
  MetroPrepareOptions,
} from '../client.ts';
import { AppError } from '../utils/errors.ts';
import { resolveCliOptions } from '../utils/cli-options.ts';

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

  const stdout = await captureStdout(async () => {
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
        metroRuntimeFile: './.agent-device/metro-runtime.json',
        metroNoReuseExisting: true,
        metroNoInstallDeps: true,
      },
      client,
    });
    assert.equal(handled, true);
  });
  const payload = JSON.parse(stdout);

  assert.deepEqual(observed, {
    projectRoot: './apps/demo',
    publicBaseUrl: 'https://sandbox.example.test',
    proxyBaseUrl: 'https://proxy.example.test',
    bearerToken: 'secret',
    port: 9090,
    kind: 'expo',
    runtimeFilePath: './.agent-device/metro-runtime.json',
    reuseExisting: false,
    installDependenciesIfNeeded: false,
    listenHost: undefined,
    statusHost: undefined,
    startupTimeoutMs: undefined,
    probeTimeoutMs: undefined,
  });
  assert.equal(payload.kind, 'react-native');
  assert.equal(payload.runtimeFilePath, null);
});

test('screenshot forwards --overlay-refs to the client capture API', async () => {
  let observed:
    | {
        path?: string;
        overlayRefs?: boolean;
      }
    | undefined;
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    screenshot: async (options) => {
      observed = options;
      return {
        path: '/tmp/screenshot.png',
        identifiers: { session: 'default' },
      };
    },
  });

  const handled = await tryRunClientBackedCommand({
    command: 'screenshot',
    positionals: ['/tmp/screenshot.png'],
    flags: {
      json: false,
      help: false,
      version: false,
      overlayRefs: true,
    },
    client,
  });

  assert.equal(handled, true);
  assert.deepEqual(observed, {
    path: '/tmp/screenshot.png',
    overlayRefs: true,
  });
});

test('screenshot reports annotated ref count in non-json mode', async () => {
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    screenshot: async () => ({
      path: '/tmp/screenshot.png',
      overlayRefs: [
        {
          ref: 'e1',
          rect: { x: 0, y: 0, width: 10, height: 10 },
          overlayRect: { x: 0, y: 0, width: 20, height: 20 },
          center: { x: 10, y: 10 },
        },
        {
          ref: 'e2',
          rect: { x: 20, y: 0, width: 10, height: 10 },
          overlayRect: { x: 40, y: 0, width: 20, height: 20 },
          center: { x: 50, y: 10 },
        },
      ],
      identifiers: { session: 'default' },
    }),
  });

  const stdout = await captureStdout(async () => {
    const handled = await tryRunClientBackedCommand({
      command: 'screenshot',
      positionals: ['/tmp/screenshot.png'],
      flags: {
        json: false,
        help: false,
        version: false,
        overlayRefs: true,
      },
      client,
    });
    assert.equal(handled, true);
  });

  assert.equal(stdout, 'Annotated 2 refs onto /tmp/screenshot.png\n');
});

test('metro prepare wraps output in the standard success envelope for --json', async () => {
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
  });

  const stdout = await captureStdout(async () => {
    const handled = await tryRunClientBackedCommand({
      command: 'metro',
      positionals: ['prepare'],
      flags: {
        json: true,
        help: false,
        version: false,
        metroPublicBaseUrl: 'https://sandbox.example.test',
      },
      client,
    });
    assert.equal(handled, true);
  });

  const payload = JSON.parse(stdout);
  assert.equal(payload.success, true);
  assert.equal(payload.data.kind, 'react-native');
  assert.equal(payload.data.iosRuntime.platform, 'ios');
});

test('metro prepare with --remote-config loads profile defaults', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-metro-'));
  const configDir = path.join(tmpRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const remoteConfigPath = path.join(configDir, 'remote.json');
  fs.writeFileSync(
    remoteConfigPath,
    JSON.stringify({
      metroProjectRoot: './apps/demo',
      metroPublicBaseUrl: 'https://sandbox.example.test',
      metroProxyBaseUrl: 'https://proxy.example.test',
      metroPreparePort: 9090,
    }),
  );
  const parsed = resolveCliOptions(['metro', 'prepare', '--remote-config', remoteConfigPath], {
    cwd: tmpRoot,
    env: process.env,
  });

  let observedPrepare: MetroPrepareOptions | undefined;
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    prepareMetro: async (options) => {
      observedPrepare = options;
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

  const stdout = await captureStdout(async () => {
    const handled = await tryRunClientBackedCommand({
      command: 'metro',
      positionals: ['prepare'],
      flags: parsed.flags,
      client,
    });
    assert.equal(handled, true);
  });
  const payload = JSON.parse(stdout);
  assert.deepEqual(observedPrepare, {
    projectRoot: path.join(configDir, 'apps/demo'),
    kind: undefined,
    publicBaseUrl: 'https://sandbox.example.test',
    proxyBaseUrl: 'https://proxy.example.test',
    bearerToken: undefined,
    port: 9090,
    listenHost: undefined,
    statusHost: undefined,
    startupTimeoutMs: undefined,
    probeTimeoutMs: undefined,
    reuseExisting: undefined,
    installDependenciesIfNeeded: undefined,
    runtimeFilePath: undefined,
  });
  assert.equal(payload.kind, 'react-native');
});

test('open with --remote-config prepares Metro and forwards inline runtime hints', async () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-open-'));
  const configDir = path.join(tmpRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const remoteConfigPath = path.join(configDir, 'remote.json');
  fs.writeFileSync(
    remoteConfigPath,
    JSON.stringify({
      platform: 'android',
      metroProjectRoot: './apps/demo',
      metroRuntimeFile: './.agent-device-cloud/metro-runtime.json',
      metroPublicBaseUrl: 'https://sandbox.example.test',
      metroProxyBaseUrl: 'https://proxy.example.test',
      metroPreparePort: 9090,
    }),
  );
  const parsed = resolveCliOptions(
    ['open', 'com.example.app', '--remote-config', remoteConfigPath],
    {
      cwd: tmpRoot,
      env: process.env,
    },
  );

  let observedPrepare: MetroPrepareOptions | undefined;
  let observedOpen: AppOpenOptions | undefined;
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    prepareMetro: async (options) => {
      observedPrepare = options;
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
          metroHost: '10.0.2.2',
          metroPort: 9090,
          bundleUrl: 'https://sandbox.example.test/index.bundle?platform=android',
          launchUrl: 'myapp://dev',
        },
        bridge: null,
      };
    },
    open: async (options) => {
      observedOpen = options;
      return {
        session: options.session ?? 'default',
        runtime: options.runtime,
        identifiers: { session: options.session ?? 'default' },
      };
    },
  });

  const handled = await tryRunClientBackedCommand({
    command: 'open',
    positionals: ['com.example.app'],
    flags: { ...parsed.flags, relaunch: true },
    client,
  });

  assert.equal(handled, true);
  assert.deepEqual(observedPrepare, {
    projectRoot: path.join(configDir, 'apps/demo'),
    kind: undefined,
    publicBaseUrl: 'https://sandbox.example.test',
    proxyBaseUrl: 'https://proxy.example.test',
    bearerToken: undefined,
    port: 9090,
    listenHost: undefined,
    statusHost: undefined,
    startupTimeoutMs: undefined,
    probeTimeoutMs: undefined,
    reuseExisting: undefined,
    installDependenciesIfNeeded: undefined,
    runtimeFilePath: path.join(configDir, '.agent-device-cloud/metro-runtime.json'),
  });
  assert.deepEqual(observedOpen?.runtime, {
    platform: 'android',
    metroHost: '10.0.2.2',
    metroPort: 9090,
    bundleUrl: 'https://sandbox.example.test/index.bundle?platform=android',
    launchUrl: 'myapp://dev',
  });
});

test('open with --remote-config preserves CLI overrides over profile defaults', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-open-override-'));
  const configDir = path.join(tmpRoot, 'config');
  fs.mkdirSync(configDir, { recursive: true });
  const remoteConfigPath = path.join(configDir, 'remote.json');
  fs.writeFileSync(
    remoteConfigPath,
    JSON.stringify({
      session: 'remote-session',
      platform: 'android',
      daemonBaseUrl: 'http://remote-mac.example.test:9124/agent-device',
      metroPublicBaseUrl: 'https://sandbox.example.test',
    }),
  );

  const parsed = resolveCliOptions(
    [
      'open',
      'com.example.app',
      '--remote-config',
      remoteConfigPath,
      '--session',
      'cli-session',
      '--platform',
      'ios',
      '--daemon-base-url',
      'http://cli-mac.example.test:9124/agent-device',
    ],
    {
      cwd: tmpRoot,
      env: process.env,
    },
  );

  assert.equal(parsed.flags.session, 'cli-session');
  assert.equal(parsed.flags.platform, 'ios');
  assert.equal(parsed.flags.daemonBaseUrl, 'http://cli-mac.example.test:9124/agent-device');
  assert.equal(parsed.flags.metroPublicBaseUrl, 'https://sandbox.example.test');
});

test('install prints command-owned success output in human mode', async () => {
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install-from-source call');
    },
  });

  const stdout = await captureStdout(async () => {
    const handled = await tryRunClientBackedCommand({
      command: 'install',
      positionals: ['Demo', '/tmp/Demo.app'],
      flags: {
        json: false,
        help: false,
        version: false,
      },
      client,
    });
    assert.equal(handled, true);
  });

  assert.match(stdout, /Installed: Demo/);
});

async function captureStdout(run: () => Promise<void>): Promise<string> {
  let stdout = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  (process.stdout as any).write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }

  return stdout;
}

function createStubClient(params: {
  installFromSource: AgentDeviceClient['apps']['installFromSource'];
  prepareMetro?: AgentDeviceClient['metro']['prepare'];
  open?: AgentDeviceClient['apps']['open'];
  screenshot?: AgentDeviceClient['capture']['screenshot'];
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
      open:
        params.open ??
        (async () => ({
          session: 'default',
          identifiers: { session: 'default' },
        })),
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
      screenshot:
        params.screenshot ??
        (async () => ({
          path: '/tmp/screenshot.png',
          identifiers: { session: 'default' },
        })),
    },
  };
}
