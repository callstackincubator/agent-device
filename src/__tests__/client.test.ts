import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createAgentDeviceClient, type AgentDeviceClientConfig } from '../client.ts';
import type { DaemonRequest, DaemonResponse } from '../contracts.ts';
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
  const client = createAgentDeviceClient(
    {
      ...setup.config,
      lockPolicy: 'reject',
      lockPlatform: 'ios',
    },
    { transport: setup.transport },
  );

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

test('apps.installFromSource derives Android launchTarget from packageName when daemon omits it', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      packageName: 'com.example.package-name-only',
      appName: 'PackageNameOnly',
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const result = await client.apps.installFromSource({
    platform: 'android',
    source: {
      kind: 'url',
      url: 'https://example.com/package-name-only.apk',
      headers: {},
    },
  });

  assert.deepEqual(result, {
    appName: 'PackageNameOnly',
    appId: 'com.example.package-name-only',
    bundleId: undefined,
    packageName: 'com.example.package-name-only',
    launchTarget: 'com.example.package-name-only',
    installablePath: undefined,
    archivePath: undefined,
    materializationId: undefined,
    materializationExpiresAt: undefined,
    identifiers: {
      session: 'qa',
      appId: 'com.example.package-name-only',
      appBundleId: undefined,
      package: 'com.example.package-name-only',
    },
  });
});

test('apps.list forwards filters and returns daemon app names', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      apps: ['Settings (com.apple.Preferences)', 'Demo (com.example.demo)', { ignored: true }],
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const apps = await client.apps.list({
    platform: 'ios',
    device: 'iPhone 16',
    appsFilter: 'user-installed',
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.command, 'apps');
  assert.deepEqual(setup.calls[0]?.positionals, []);
  assert.equal(setup.calls[0]?.flags?.platform, 'ios');
  assert.equal(setup.calls[0]?.flags?.device, 'iPhone 16');
  assert.equal(setup.calls[0]?.flags?.appsFilter, 'user-installed');
  assert.deepEqual(apps, ['Settings (com.apple.Preferences)', 'Demo (com.example.demo)']);
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

test('replay.run serializes client-collected AD_VAR shell env into daemon request', async () => {
  const previousAppId = process.env.AD_VAR_APP_ID;
  const previousWaitMs = process.env.AD_VAR_WAIT_MS;
  const previousLegacy = process.env.AD_APP_ID;
  process.env.AD_VAR_APP_ID = 'com.example.debug';
  process.env.AD_VAR_WAIT_MS = '750';
  process.env.AD_APP_ID = 'legacy-prefix-ignored';
  try {
    const setup = createTransport(async () => ({ ok: true, data: {} }));
    const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

    await client.replay.run({
      path: './flows/login.ad',
      env: ['APP_ID=cli-override'],
    });

    assert.equal(setup.calls.length, 1);
    assert.equal(setup.calls[0]?.command, 'replay');
    assert.deepEqual(setup.calls[0]?.positionals, ['./flows/login.ad']);
    assert.deepEqual(setup.calls[0]?.flags?.replayEnv, ['APP_ID=cli-override']);
    const replayShellEnv = setup.calls[0]?.flags?.replayShellEnv as
      | Record<string, string>
      | undefined;
    assert.equal(replayShellEnv?.AD_VAR_APP_ID, 'com.example.debug');
    assert.equal(replayShellEnv?.AD_VAR_WAIT_MS, '750');
    assert.equal(Object.prototype.hasOwnProperty.call(replayShellEnv ?? {}, 'AD_APP_ID'), false);
  } finally {
    if (previousAppId === undefined) delete process.env.AD_VAR_APP_ID;
    else process.env.AD_VAR_APP_ID = previousAppId;
    if (previousWaitMs === undefined) delete process.env.AD_VAR_WAIT_MS;
    else process.env.AD_VAR_WAIT_MS = previousWaitMs;
    if (previousLegacy === undefined) delete process.env.AD_APP_ID;
    else process.env.AD_APP_ID = previousLegacy;
  }
});

test('client.command.wait prepares selector options and rejects invalid selectors', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {},
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  await client.command.wait({
    selector: 'role=button[name="Continue"]',
    timeoutMs: 1_500,
    depth: 3,
    raw: true,
  });

  assert.equal(setup.calls.length, 1);
  assert.equal(setup.calls[0]?.command, 'wait');
  assert.deepEqual(setup.calls[0]?.positionals, ['role=button[name="Continue"]', '1500']);
  assert.equal(setup.calls[0]?.flags?.snapshotDepth, 3);
  assert.equal(setup.calls[0]?.flags?.snapshotRaw, true);

  await assert.rejects(
    async () => await client.command.wait({ selector: 'Continue' }),
    /Invalid wait selector: Continue/,
  );
  assert.equal(setup.calls.length, 1);
});

test('lease helpers forward scope through daemon-backed client methods', async () => {
  const setup = createTransport(async (req) => ({
    ok: true,
    data:
      req.command === 'lease_release'
        ? { released: true }
        : {
            lease: {
              leaseId: req.meta?.leaseId ?? 'lease-new',
              tenantId: req.meta?.tenantId,
              runId: req.meta?.runId,
              backend: req.meta?.leaseBackend,
            },
          },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const allocated = await client.leases.allocate({
    tenant: 'remote-tenant',
    runId: 'remote-run',
    leaseBackend: 'android-instance',
  });
  const released = await client.leases.release({
    tenant: 'remote-tenant',
    runId: 'remote-run',
    leaseId: allocated.leaseId,
  });

  assert.equal(setup.calls[0]?.command, 'lease_allocate');
  assert.equal(setup.calls[0]?.meta?.tenantId, 'remote-tenant');
  assert.equal(setup.calls[0]?.meta?.runId, 'remote-run');
  assert.equal(setup.calls[0]?.meta?.leaseBackend, 'android-instance');
  assert.equal(allocated.leaseId, 'lease-new');
  assert.equal(setup.calls[1]?.command, 'lease_release');
  assert.equal(setup.calls[1]?.meta?.leaseId, 'lease-new');
  assert.equal(released.released, true);
});

test('client capture.snapshot preserves visibility metadata from daemon responses', async () => {
  const setup = createTransport(async () => ({
    ok: true,
    data: {
      nodes: [],
      truncated: false,
      appBundleId: 'com.expensify.chat.dev',
      visibility: {
        partial: true,
        visibleNodeCount: 64,
        totalNodeCount: 67,
        reasons: ['offscreen-nodes'],
      },
    },
  }));
  const client = createAgentDeviceClient(setup.config, { transport: setup.transport });

  const result = await client.capture.snapshot();

  assert.deepEqual(result.visibility, {
    partial: true,
    visibleNodeCount: 64,
    totalNodeCount: 67,
    reasons: ['offscreen-nodes'],
  });
});
