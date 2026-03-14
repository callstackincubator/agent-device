import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAgentDeviceClient,
  type AgentDeviceClientConfig,
} from '../client.ts';
import type { DaemonRequest, DaemonResponse } from '../daemon/types.ts';
import { AppError } from '../utils/errors.ts';

function createTransport(
  handler: (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse> | DaemonResponse,
): {
  calls: Array<Omit<DaemonRequest, 'token'>>;
  config: AgentDeviceClientConfig;
  transport: (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse>;
} {
  const calls: Array<Omit<DaemonRequest, 'token'>> = [];
  const config: AgentDeviceClientConfig = {
    session: 'qa',
    cwd: '/tmp/agent-device',
    debug: true,
    daemonBaseUrl: 'http://daemon.example.test',
    daemonAuthToken: 'secret',
    daemonTransport: 'http',
    tenant: 'acme',
    sessionIsolation: 'tenant',
    runId: 'run-123',
    leaseId: 'lease-123',
  };
  return {
    calls,
    config,
    transport: async (req) => {
      calls.push(req);
      return await handler(req);
    },
  };
}

test('devices.list maps daemon devices into normalized identifiers', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      devices: [
        {
          platform: 'ios',
          id: 'SIM-001',
          name: 'iPhone 16',
          kind: 'simulator',
          target: 'mobile',
          booted: true,
        },
      ],
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const devices = await client.devices.list({
    platform: 'ios',
    iosSimulatorDeviceSet: '/tmp/sim-set',
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.command, 'devices');
  assert.deepEqual(setup.calls[0]?.flags, {
    daemonBaseUrl: 'http://daemon.example.test',
    daemonAuthToken: 'secret',
    daemonTransport: 'http',
    tenant: 'acme',
    sessionIsolation: 'tenant',
    runId: 'run-123',
    leaseId: 'lease-123',
    platform: 'ios',
    iosSimulatorDeviceSet: '/tmp/sim-set',
    verbose: true,
  });
  assert.deepEqual(devices, [
    {
      platform: 'ios',
      target: 'mobile',
      kind: 'simulator',
      id: 'SIM-001',
      name: 'iPhone 16',
      booted: true,
      identifiers: {
        deviceId: 'SIM-001',
        deviceName: 'iPhone 16',
        udid: 'SIM-001',
      },
      ios: {
        udid: 'SIM-001',
      },
      android: undefined,
    },
  ]);
});

test('typed client forwards shared request lock policy metadata', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      devices: [],
    },
  }));
  const client = createAgentDeviceClient({
    ...setup.config,
    lockPolicy: 'reject',
    lockPlatform: 'ios',
  }, { transport: setup.transport });

  await client.devices.list({
    device: 'Pixel 9',
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.meta?.lockPolicy, 'reject');
  assert.equal(setup.calls[0]?.meta?.lockPlatform, 'ios');
  assert.equal(setup.calls[0]?.flags?.device, 'Pixel 9');
});

test('apps.open resolves session device identifiers from open response', async () => {
  const setup = createTransport(async (req) => {
    if (req.command === 'open') {
      return {
        ok: true,
        data: {
          session: 'qa',
          appName: 'Settings',
          appBundleId: 'com.apple.Preferences',
          platform: 'ios',
          target: 'mobile',
          device: 'iPhone 16',
          id: 'SIM-001',
          kind: 'simulator',
          device_udid: 'SIM-001',
          ios_simulator_device_set: '/tmp/sim-set',
          startup: {
            durationMs: 1234,
            measuredAt: '2026-03-13T10:00:00.000Z',
            method: 'open-command-roundtrip',
          },
        },
      };
    }
    throw new Error(`Unexpected command: ${req.command}`);
  });
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const result = await client.apps.open({
    app: 'Settings',
    platform: 'ios',
    relaunch: true,
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.command, 'open');
  assert.deepEqual(setup.calls[0]?.positionals, ['Settings']);
  assert.equal(result.identifiers.session, 'qa');
  assert.equal(result.identifiers.deviceId, 'SIM-001');
  assert.equal(result.identifiers.udid, 'SIM-001');
  assert.equal(result.identifiers.appId, 'com.apple.Preferences');
  assert.equal(result.device?.name, 'iPhone 16');
  assert.equal(result.device?.ios?.simulatorSetPath, '/tmp/sim-set');
});

test('apps.open forwards explicit runtime hints through the daemon request', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      session: 'qa',
      appName: 'Demo',
      appBundleId: 'com.example.demo',
      runtime: {
        platform: 'ios',
        metroHost: '127.0.0.1',
        metroPort: 8081,
      },
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const result = await client.apps.open({
    app: 'Demo',
    platform: 'ios',
    runtime: {
      metroHost: '127.0.0.1',
      metroPort: 8081,
    },
  });

  assert.equal(setup.calls.length, 1);
  assert.deepEqual(setup.calls[0]?.runtime, {
    metroHost: '127.0.0.1',
    metroPort: 8081,
  });
  assert.deepEqual(result.runtime, {
    platform: 'ios',
    metroHost: '127.0.0.1',
    metroPort: 8081,
    bundleUrl: undefined,
    launchUrl: undefined,
  });
});

test('apps.installFromSource forwards source payload and normalizes launch identity', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      packageName: 'com.example.demo',
      appName: 'Demo',
      launchTarget: 'com.example.demo',
      installablePath: '/tmp/materialized/installable/demo.apk',
      archivePath: '/tmp/materialized/archive/demo.zip',
      materializationId: 'materialized-123',
      materializationExpiresAt: '2026-03-13T12:00:00.000Z',
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const result = await client.apps.installFromSource({
    platform: 'android',
    retainPaths: true,
    retentionMs: 60_000,
    source: {
      kind: 'url',
      url: 'https://example.com/demo.apk',
      headers: { authorization: 'Bearer token' },
    },
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.command, 'install_source');
  assert.deepEqual(setup.calls[0]?.meta?.installSource, {
    kind: 'url',
    url: 'https://example.com/demo.apk',
    headers: { authorization: 'Bearer token' },
  });
  assert.equal(setup.calls[0]?.meta?.retainMaterializedPaths, true);
  assert.equal(setup.calls[0]?.meta?.materializedPathRetentionMs, 60_000);
  assert.deepEqual(result, {
    appName: 'Demo',
    appId: 'com.example.demo',
    bundleId: undefined,
    packageName: 'com.example.demo',
    launchTarget: 'com.example.demo',
    installablePath: '/tmp/materialized/installable/demo.apk',
    archivePath: '/tmp/materialized/archive/demo.zip',
    materializationId: 'materialized-123',
    materializationExpiresAt: '2026-03-13T12:00:00.000Z',
    identifiers: {
      session: 'qa',
      appId: 'com.example.demo',
      appBundleId: undefined,
      package: 'com.example.demo',
    },
  });
});

test('materializations.release forwards materialization identity through the daemon request', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      released: true,
      materializationId: 'materialized-123',
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const result = await client.materializations.release({
    materializationId: 'materialized-123',
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.command, 'release_materialized_paths');
  assert.equal(setup.calls[0]?.meta?.materializationId, 'materialized-123');
  assert.deepEqual(result, {
    released: true,
    materializationId: 'materialized-123',
    identifiers: {},
  });
});

test('client throws AppError for daemon failures', async () => {
  const setup = createTransport(async () => ({
    ok: false,
    error: {
      code: 'SESSION_NOT_FOUND',
      message: 'No active session',
      hint: 'Run open first.',
      diagnosticId: 'diag-1',
      logPath: '/tmp/daemon.log',
      details: { session: 'qa' },
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  await assert.rejects(
    async () => await client.capture.snapshot(),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'SESSION_NOT_FOUND');
      assert.equal(error.message, 'No active session');
      assert.equal(error.details?.hint, 'Run open first.');
      assert.equal(error.details?.diagnosticId, 'diag-1');
      assert.equal(error.details?.logPath, '/tmp/daemon.log');
      assert.deepEqual(error.details?.session, 'qa');
      return true;
    },
  );
});
