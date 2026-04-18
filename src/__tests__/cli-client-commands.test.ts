import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { tryRunClientBackedCommand } from '../cli/commands/router.ts';
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
        tenant: 'tenant-1',
        runId: 'run-1',
        leaseId: 'lease-1',
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
    bridgeScope: {
      tenantId: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
    },
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

test('metro prepare rejects when no public or proxy base URL is provided', async () => {
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    prepareMetro: async () => {
      throw new Error('unexpected metro prepare call');
    },
  });

  await assert.rejects(
    () =>
      tryRunClientBackedCommand({
        command: 'metro',
        positionals: ['prepare'],
        flags: {
          json: false,
          help: false,
          version: false,
        },
        client,
      }),
    (error) =>
      error instanceof AppError &&
      error.code === 'INVALID_ARGS' &&
      error.message.includes('--public-base-url <url> or --proxy-base-url <url>'),
  );
});

test('screenshot forwards --overlay-refs to the client capture API', async () => {
  let observed:
    | {
        path?: string;
        overlayRefs?: boolean;
        maxSize?: number;
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
      screenshotMaxSize: 1024,
    },
    client,
  });

  assert.equal(handled, true);
  assert.deepEqual(observed, {
    path: '/tmp/screenshot.png',
    overlayRefs: true,
    maxSize: 1024,
  });
});

test('diff screenshot forwards --surface to live client screenshot capture', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-cli-diff-surface-'));
  const baseline = path.join(dir, 'baseline.png');
  const out = path.join(dir, 'diff.png');
  fs.writeFileSync(baseline, solidPngBuffer(4, 4, { r: 0, g: 0, b: 0 }));
  let observed: Parameters<AgentDeviceClient['capture']['screenshot']>[0] | undefined;

  try {
    const client = createStubClient({
      installFromSource: async () => {
        throw new Error('unexpected install call');
      },
      screenshot: async (options) => {
        if (!options?.path) {
          throw new Error('expected runtime to request a live screenshot path');
        }
        observed = options;
        fs.writeFileSync(options.path, solidPngBuffer(4, 4, { r: 255, g: 255, b: 255 }));
        return {
          path: options.path,
          identifiers: { session: options.session ?? 'default' },
        };
      },
    });

    await captureStdout(async () => {
      const handled = await tryRunClientBackedCommand({
        command: 'diff',
        positionals: ['screenshot'],
        flags: {
          json: true,
          help: false,
          version: false,
          baseline,
          out,
          platform: 'macos',
          session: 'surface-session',
          surface: 'menubar',
          threshold: '0',
        },
        client,
      });
      assert.equal(handled, true);
    });

    assert.equal(observed?.session, 'surface-session');
    assert.equal(observed?.surface, 'menubar');
    assert.equal(fs.existsSync(out), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('open forwards macOS surface to the client apps API', async () => {
  let observed: AppOpenOptions | undefined;
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
    open: async (options) => {
      observed = options;
      return {
        session: 'default',
        appName: 'MenuBarApp',
        appBundleId: 'com.example.menubarapp',
        identifiers: { session: 'default', appBundleId: 'com.example.menubarapp' },
      };
    },
  });

  const handled = await tryRunClientBackedCommand({
    command: 'open',
    positionals: ['MenuBarApp'],
    flags: {
      json: false,
      help: false,
      version: false,
      platform: 'macos',
      surface: 'menubar',
    },
    client,
  });

  assert.equal(handled, true);
  assert.equal(observed?.platform, 'macos');
  assert.equal(observed?.surface, 'menubar');
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

test('wait keeps CLI bare text behavior through the typed client command API', async () => {
  let observed: Parameters<AgentDeviceClient['command']['wait']>[0] | undefined;
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
  });
  client.command.wait = async (options) => {
    observed = options;
    return { text: 'Continue', waitedMs: 12 };
  };

  const handled = await tryRunClientBackedCommand({
    command: 'wait',
    positionals: ['Continue', '1500'],
    flags: {
      json: false,
      help: false,
      version: false,
    },
    client,
  });

  assert.equal(handled, true);
  assert.equal(observed?.text, 'Continue');
  assert.equal(observed?.timeoutMs, 1500);
});

test('clipboard read keeps human text output through the typed client command API', async () => {
  const client = createStubClient({
    installFromSource: async () => {
      throw new Error('unexpected install call');
    },
  });
  client.command.clipboard = async () => ({ action: 'read', text: 'hello' });

  const stdout = await captureStdout(async () => {
    const handled = await tryRunClientBackedCommand({
      command: 'clipboard',
      positionals: ['read'],
      flags: {
        json: false,
        help: false,
        version: false,
      },
      client,
    });
    assert.equal(handled, true);
  });

  assert.equal(stdout, 'hello\n');
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
      metroProxyBaseUrl: 'https://proxy.example.test',
      tenant: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
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
    publicBaseUrl: undefined,
    proxyBaseUrl: 'https://proxy.example.test',
    bearerToken: undefined,
    bridgeScope: {
      tenantId: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
    },
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
  const unexpectedCommandCall = async (): Promise<never> => {
    throw new Error('unexpected command call');
  };
  const command = createThrowingMethodGroup<AgentDeviceClient['command']>();
  return {
    command,
    devices: {
      list: async () => [],
      boot: unexpectedCommandCall,
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
      list: async () => [],
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
      push: unexpectedCommandCall,
      triggerEvent: unexpectedCommandCall,
    },
    materializations: {
      release: async (options) => ({
        released: true,
        materializationId: options.materializationId,
        identifiers: { session: options.session ?? 'default' },
      }),
    },
    leases: {
      allocate: async (options) => ({
        leaseId: 'lease-1',
        tenantId: options.tenant,
        runId: options.runId,
        backend: options.leaseBackend ?? 'ios-simulator',
      }),
      heartbeat: async (options) => ({
        leaseId: options.leaseId,
        tenantId: options.tenant ?? 'tenant',
        runId: options.runId ?? 'run',
        backend: options.leaseBackend ?? 'ios-simulator',
      }),
      release: async () => ({ released: true }),
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
      diff: unexpectedCommandCall,
    },
    interactions: createThrowingMethodGroup<AgentDeviceClient['interactions']>(),
    replay: createThrowingMethodGroup<AgentDeviceClient['replay']>(),
    batch: createThrowingMethodGroup<AgentDeviceClient['batch']>(),
    observability: createThrowingMethodGroup<AgentDeviceClient['observability']>(),
    recording: createThrowingMethodGroup<AgentDeviceClient['recording']>(),
    settings: createThrowingMethodGroup<AgentDeviceClient['settings']>(),
  };
}

function createThrowingMethodGroup<T extends object>(): T {
  const unexpectedCommandCall = async (): Promise<never> => {
    throw new Error('unexpected command call');
  };
  return new Proxy({} as Partial<T>, {
    get: (target, property) => target[property as keyof T] ?? unexpectedCommandCall,
  }) as T;
}

function solidPngBuffer(
  width: number,
  height: number,
  color: { r: number; g: number; b: number },
): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = color.r;
    png.data[i + 1] = color.g;
    png.data[i + 2] = color.b;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}
