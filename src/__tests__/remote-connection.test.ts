import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('../client-metro-companion.ts', () => ({
  stopMetroCompanion: vi.fn(),
}));

import {
  connectCommand,
  connectionCommand,
  disconnectCommand,
} from '../cli/commands/connection.ts';
import { stopMetroCompanion } from '../client-metro-companion.ts';
import { AppError } from '../utils/errors.ts';
import {
  hashRemoteConfigFile,
  readRemoteConnectionState,
  writeRemoteConnectionState,
} from '../remote-connection-state.ts';
import type { AgentDeviceClient, MetroPrepareOptions } from '../client.ts';
import type { LeaseBackend } from '../contracts.ts';

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const unexpectedCommandCall = async (): Promise<never> => {
  throw new Error('unexpected call');
};

function createThrowingMethodGroup<T extends object>(methods: Partial<T> = {}): T {
  return new Proxy(methods, {
    get: (target, property) => target[property as keyof T] ?? unexpectedCommandCall,
  }) as T;
}

function createTestClient(
  options: {
    allocate?: AgentDeviceClient['leases']['allocate'];
    heartbeat?: AgentDeviceClient['leases']['heartbeat'];
    release?: AgentDeviceClient['leases']['release'];
    prepare?: AgentDeviceClient['metro']['prepare'];
    closeSession?: AgentDeviceClient['sessions']['close'];
  } = {},
): AgentDeviceClient {
  return {
    command: createThrowingMethodGroup<AgentDeviceClient['command']>(),
    devices: createThrowingMethodGroup<AgentDeviceClient['devices']>(),
    sessions: createThrowingMethodGroup<AgentDeviceClient['sessions']>({
      close:
        options.closeSession ??
        (async () => ({
          session: 'adc-android',
          identifiers: { session: 'adc-android' },
        })),
    }),
    simulators: createThrowingMethodGroup<AgentDeviceClient['simulators']>(),
    apps: createThrowingMethodGroup<AgentDeviceClient['apps']>(),
    materializations: createThrowingMethodGroup<AgentDeviceClient['materializations']>(),
    leases: createThrowingMethodGroup<AgentDeviceClient['leases']>({
      allocate:
        options.allocate ??
        (async (request) => ({
          leaseId: 'lease-1',
          tenantId: request.tenant,
          runId: request.runId,
          backend: request.leaseBackend ?? 'android-instance',
        })),
      heartbeat:
        options.heartbeat ??
        (async (request) => ({
          leaseId: request.leaseId,
          tenantId: request.tenant ?? 'acme',
          runId: request.runId ?? 'run-123',
          backend: request.leaseBackend ?? 'android-instance',
        })),
      release: options.release ?? (async () => ({ released: true })),
    }),
    metro: createThrowingMethodGroup<AgentDeviceClient['metro']>({
      prepare:
        options.prepare ??
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
          iosRuntime: { platform: 'ios' },
          androidRuntime: {
            platform: 'android',
            bundleUrl: 'https://sandbox.example.test/index.bundle?platform=android',
          },
          bridge: null,
        })),
    }),
    capture: createThrowingMethodGroup<AgentDeviceClient['capture']>(),
    interactions: createThrowingMethodGroup<AgentDeviceClient['interactions']>(),
    replay: createThrowingMethodGroup<AgentDeviceClient['replay']>(),
    batch: createThrowingMethodGroup<AgentDeviceClient['batch']>(),
    observability: createThrowingMethodGroup<AgentDeviceClient['observability']>(),
    recording: createThrowingMethodGroup<AgentDeviceClient['recording']>(),
    settings: createThrowingMethodGroup<AgentDeviceClient['settings']>(),
  };
}

test('connect allocates a lease, prepares Metro, and writes connection state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(
    remoteConfigPath,
    JSON.stringify({ daemonBaseUrl: 'https://daemon.example.test' }),
  );
  let observedBackend: LeaseBackend | undefined;
  let observedPrepare: MetroPrepareOptions | undefined;

  await captureStdout(async () => {
    await connectCommand({
      positionals: [],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
        remoteConfig: remoteConfigPath,
        daemonBaseUrl:
          'https://user:pass@daemon.example.test/agent-device?token=redacted&apiKey=redacted&tenant=acme',
        tenant: 'acme',
        sessionIsolation: 'tenant',
        runId: 'run-123',
        session: 'adc-android',
        platform: 'android',
        metroPublicBaseUrl: 'https://sandbox.example.test',
        metroProxyBaseUrl: 'https://proxy.example.test',
      },
      client: createTestClient({
        allocate: async (request) => {
          observedBackend = request.leaseBackend;
          return {
            leaseId: 'lease-1',
            tenantId: request.tenant,
            runId: request.runId,
            backend: request.leaseBackend ?? 'android-instance',
          };
        },
        prepare: async (options) => {
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
            iosRuntime: { platform: 'ios' },
            androidRuntime: { platform: 'android', bundleUrl: 'https://bundle.example.test' },
            bridge: null,
          };
        },
      }),
    });
  });

  const state = readRemoteConnectionState({ stateDir, session: 'adc-android' });
  assert.equal(observedBackend, 'android-instance');
  assert.equal(observedPrepare?.companionProfileKey, remoteConfigPath);
  assert.equal(state?.leaseId, 'lease-1');
  assert.equal(state?.remoteConfigHash, hashRemoteConfigFile(remoteConfigPath));
  assert.deepEqual(state?.daemon, {
    baseUrl: 'https://daemon.example.test/agent-device?tenant=acme',
  });
  assert.equal(state?.metro?.projectRoot, '/tmp/project');
  assert.deepEqual(state?.runtime, {
    platform: 'android',
    bundleUrl: 'https://bundle.example.test',
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect missing scope errors mention remote config or flags', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-scope-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://daemon.example' }));

  await assert.rejects(
    async () =>
      await connectCommand({
        positionals: [],
        flags: {
          json: true,
          help: false,
          version: false,
          stateDir,
          remoteConfig: remoteConfigPath,
          daemonBaseUrl: 'https://daemon.example',
          platform: 'android',
        },
        client: createTestClient(),
      }),
    /connect requires tenant in remote config or via --tenant <id>/,
  );

  await assert.rejects(
    async () =>
      await connectCommand({
        positionals: [],
        flags: {
          json: true,
          help: false,
          version: false,
          stateDir,
          remoteConfig: remoteConfigPath,
          daemonBaseUrl: 'https://daemon.example',
          tenant: 'acme',
          platform: 'android',
        },
        client: createTestClient(),
      }),
    /connect requires runId in remote config or via --run-id <id>/,
  );

  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect reuses an active compatible lease by heartbeat', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-heartbeat-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://daemon.example' }));
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc-android',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      daemon: { baseUrl: 'https://daemon.example' },
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-old',
      leaseBackend: 'android-instance',
      platform: 'android',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  let heartbeatCount = 0;

  await captureStdout(async () => {
    await connectCommand({
      positionals: [],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
        remoteConfig: remoteConfigPath,
        daemonBaseUrl: 'https://daemon.example',
        tenant: 'acme',
        runId: 'run-123',
        session: 'adc-android',
        platform: 'android',
      },
      client: createTestClient({
        heartbeat: async (request) => {
          heartbeatCount += 1;
          return {
            leaseId: request.leaseId,
            tenantId: request.tenant ?? 'acme',
            runId: request.runId ?? 'run-123',
            backend: 'android-instance',
          };
        },
        allocate: async () => {
          throw new Error('allocate should not run');
        },
      }),
    });
  });

  assert.equal(heartbeatCount, 1);
  assert.equal(
    readRemoteConnectionState({ stateDir, session: 'adc-android' })?.leaseId,
    'lease-old',
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect allocates a new lease when cloud reports the stored lease is inactive', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-stale-lease-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://daemon.example' }));
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc-android',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      daemon: { baseUrl: 'https://daemon.example' },
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-old',
      leaseBackend: 'android-instance',
      platform: 'android',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  let allocateCount = 0;

  await captureStdout(async () => {
    await connectCommand({
      positionals: [],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
        remoteConfig: remoteConfigPath,
        daemonBaseUrl: 'https://daemon.example',
        tenant: 'acme',
        runId: 'run-123',
        session: 'adc-android',
        platform: 'android',
      },
      client: createTestClient({
        heartbeat: async () => {
          throw new AppError('UNAUTHORIZED', 'Lease is not active', {
            reason: 'LEASE_NOT_FOUND',
          });
        },
        allocate: async (request) => {
          allocateCount += 1;
          return {
            leaseId: 'lease-new',
            tenantId: request.tenant,
            runId: request.runId,
            backend: request.leaseBackend ?? 'android-instance',
          };
        },
      }),
    });
  });

  assert.equal(allocateCount, 1);
  assert.equal(
    readRemoteConnectionState({ stateDir, session: 'adc-android' })?.leaseId,
    'lease-new',
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect does not allocate when heartbeat fails for auth or scope reasons', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-auth-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://daemon.example' }));
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc-android',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      daemon: { baseUrl: 'https://daemon.example' },
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-old',
      leaseBackend: 'android-instance',
      platform: 'android',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  await assert.rejects(
    async () =>
      await connectCommand({
        positionals: [],
        flags: {
          json: true,
          help: false,
          version: false,
          stateDir,
          remoteConfig: remoteConfigPath,
          daemonBaseUrl: 'https://daemon.example',
          tenant: 'acme',
          runId: 'run-123',
          session: 'adc-android',
          platform: 'android',
        },
        client: createTestClient({
          heartbeat: async () => {
            throw new AppError('UNAUTHORIZED', 'Request rejected by auth hook', {
              reason: 'AUTH_FAILED',
            });
          },
          allocate: async () => {
            throw new Error('allocate should not run');
          },
        }),
      }),
    /Request rejected by auth hook/,
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect requires force when compatible scope changes platform', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-platform-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://daemon.example' }));
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-old',
      leaseBackend: 'android-instance',
      platform: 'android',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  await assert.rejects(
    async () =>
      await connectCommand({
        positionals: [],
        flags: {
          json: true,
          help: false,
          version: false,
          stateDir,
          remoteConfig: remoteConfigPath,
          daemonBaseUrl: 'https://daemon.example',
          tenant: 'acme',
          runId: 'run-123',
          session: 'adc',
          platform: 'ios',
          leaseBackend: 'android-instance',
        },
        client: createTestClient(),
      }),
    /A different remote connection is already active/,
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect requires force when the daemon endpoint changes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-daemon-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://old.example' }));
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      daemon: { baseUrl: 'https://old.example' },
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-old',
      leaseBackend: 'android-instance',
      platform: 'android',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  await assert.rejects(
    async () =>
      await connectCommand({
        positionals: [],
        flags: {
          json: true,
          help: false,
          version: false,
          stateDir,
          remoteConfig: remoteConfigPath,
          daemonBaseUrl: 'https://new.example',
          tenant: 'acme',
          runId: 'run-123',
          session: 'adc',
          platform: 'android',
        },
        client: createTestClient(),
      }),
    /A different remote connection is already active/,
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect --force stops replaced Metro companion after state is updated', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-force-'));
  const stateDir = path.join(tempRoot, '.state');
  const oldRemoteConfigPath = path.join(tempRoot, 'old-remote.json');
  const newRemoteConfigPath = path.join(tempRoot, 'new-remote.json');
  fs.writeFileSync(oldRemoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://old.example' }));
  fs.writeFileSync(newRemoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://new.example' }));
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc-android',
      remoteConfigPath: oldRemoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(oldRemoteConfigPath),
      tenant: 'acme',
      runId: 'run-old',
      leaseId: 'lease-old',
      leaseBackend: 'android-instance',
      daemon: {
        baseUrl: 'https://old.example',
        transport: 'http',
      },
      metro: {
        projectRoot: '/tmp/old-project',
        profileKey: oldRemoteConfigPath,
        consumerKey: 'adc-android',
      },
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
  let releaseRequest: Parameters<AgentDeviceClient['leases']['release']>[0] | undefined;

  await captureStdout(async () => {
    await connectCommand({
      positionals: [],
      flags: {
        json: true,
        help: false,
        version: false,
        force: true,
        stateDir,
        remoteConfig: newRemoteConfigPath,
        daemonBaseUrl: 'https://new.example',
        tenant: 'acme',
        runId: 'run-new',
        session: 'adc-android',
        platform: 'android',
        metroPublicBaseUrl: 'https://sandbox.example.test',
        metroProxyBaseUrl: 'https://proxy.example.test',
      },
      client: createTestClient({
        release: async (request) => {
          releaseRequest = request;
          return { released: true };
        },
      }),
    });
  });

  assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
    projectRoot: '/tmp/old-project',
    profileKey: oldRemoteConfigPath,
    consumerKey: 'adc-android',
  });
  assert.equal(releaseRequest?.leaseId, 'lease-old');
  assert.equal(releaseRequest?.daemonBaseUrl, 'https://old.example');
  assert.equal(releaseRequest?.daemonTransport, 'http');
  assert.equal(readRemoteConnectionState({ stateDir, session: 'adc-android' })?.runId, 'run-new');
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connect cleans up prepared Metro companion if state write fails', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connect-fail-'));
  const stateDir = path.join(tempRoot, 'state-file');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(stateDir, 'not a directory');
  fs.writeFileSync(remoteConfigPath, JSON.stringify({ daemonBaseUrl: 'https://daemon.example' }));
  let releaseCount = 0;

  await assert.rejects(
    async () =>
      await connectCommand({
        positionals: [],
        flags: {
          json: true,
          help: false,
          version: false,
          stateDir,
          remoteConfig: remoteConfigPath,
          daemonBaseUrl: 'https://daemon.example',
          tenant: 'acme',
          runId: 'run-123',
          platform: 'android',
          metroPublicBaseUrl: 'https://sandbox.example.test',
          metroProxyBaseUrl: 'https://proxy.example.test',
        },
        client: createTestClient({
          release: async () => {
            releaseCount += 1;
            return { released: true };
          },
        }),
      }),
  );

  assert.equal(releaseCount, 1);
  assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
    projectRoot: '/tmp/project',
    profileKey: remoteConfigPath,
    consumerKey: 'default',
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('disconnect tolerates prior close and removes local connection state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-disconnect-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.mkdirSync(path.join(stateDir, 'remote-connections'), { recursive: true });
  fs.writeFileSync(remoteConfigPath, '{}');
  fs.writeFileSync(
    path.join(stateDir, 'remote-connections', 'adc-android.json'),
    JSON.stringify({
      version: 1,
      session: 'adc-android',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-1',
      leaseBackend: 'android-instance',
      metro: {
        projectRoot: '/tmp/project',
        profileKey: remoteConfigPath,
        consumerKey: 'adc-android',
      },
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
  );

  let handled = false;
  await captureStdout(async () => {
    handled = await disconnectCommand({
      positionals: [],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
        session: 'adc-android',
        shutdown: true,
      },
      client: createTestClient({
        closeSession: async () => {
          throw new Error('already closed');
        },
        release: async () => ({ released: false }),
      }),
    });
  });

  assert.equal(handled, true);
  assert.equal(readRemoteConnectionState({ stateDir, session: 'adc-android' }), null);
  assert.deepEqual(vi.mocked(stopMetroCompanion).mock.calls[0]?.[0], {
    projectRoot: '/tmp/project',
    profileKey: remoteConfigPath,
    consumerKey: 'adc-android',
  });
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('disconnect without a session uses active connection state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-disconnect-active-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, '{}');
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc-android',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-1',
      leaseBackend: 'android-instance',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  await captureStdout(async () => {
    await disconnectCommand({
      positionals: [],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
        shutdown: true,
      },
      client: createTestClient(),
    });
  });

  assert.equal(readRemoteConnectionState({ stateDir, session: 'adc-android' }), null);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connection status reports missing state without daemon calls', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connection-status-'));
  let handled = false;
  await captureStdout(async () => {
    handled = await connectionCommand({
      positionals: ['status'],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir: path.join(tempRoot, '.state'),
        session: 'adc-android',
      },
      client: createTestClient(),
    });
  });
  assert.equal(handled, true);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connection status reports active connection state', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connection-active-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, '{}');
  writeRemoteConnectionState({
    stateDir,
    state: {
      version: 1,
      session: 'adc-android',
      remoteConfigPath,
      remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
      tenant: 'acme',
      runId: 'run-123',
      leaseId: 'lease-1',
      leaseBackend: 'android-instance',
      connectedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });

  const output = await captureStdout(async () => {
    await connectionCommand({
      positionals: ['status'],
      flags: {
        json: true,
        help: false,
        version: false,
        stateDir,
      },
      client: createTestClient(),
    });
  });

  assert.equal(JSON.parse(output).data.session, 'adc-android');
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test('connection state filenames distinguish unsafe session names', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-connection-state-names-'));
  const stateDir = path.join(tempRoot, '.state');
  const remoteConfigPath = path.join(tempRoot, 'remote.json');
  fs.writeFileSync(remoteConfigPath, '{}');
  const baseState = {
    version: 1 as const,
    remoteConfigPath,
    remoteConfigHash: hashRemoteConfigFile(remoteConfigPath),
    tenant: 'acme',
    runId: 'run-123',
    leaseBackend: 'android-instance' as const,
    connectedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  writeRemoteConnectionState({
    stateDir,
    state: { ...baseState, session: 'a/b', leaseId: 'lease-slash' },
  });
  writeRemoteConnectionState({
    stateDir,
    state: { ...baseState, session: 'a_b', leaseId: 'lease-underscore' },
  });

  assert.equal(readRemoteConnectionState({ stateDir, session: 'a/b' })?.leaseId, 'lease-slash');
  assert.equal(
    readRemoteConnectionState({ stateDir, session: 'a_b' })?.leaseId,
    'lease-underscore',
  );
  fs.rmSync(tempRoot, { recursive: true, force: true });
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
