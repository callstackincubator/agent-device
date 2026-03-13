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
