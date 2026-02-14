import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeviceInfo } from '../../utils/device.ts';
import { resolveIosAppStateFromSnapshots } from '../app-state.ts';
import type { CommandFlags, dispatchCommand } from '../../core/dispatch.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

const iosDevice: DeviceInfo = {
  platform: 'ios',
  id: '00008110-000E12341234002E',
  name: 'iPhone',
  kind: 'device',
  booted: true,
};

test('appstate uses xctest first on iOS simulator', async () => {
  const backends: string[] = [];
  const fakeDispatch: typeof dispatchCommand = async (_device, _command, _positionals, _outPath, context) => {
    backends.push(context?.snapshotBackend ?? 'unknown');
    return {
      nodes: [
        {
          type: 'XCUIElementTypeApplication',
          label: 'Settings',
          identifier: 'com.apple.Preferences',
        },
      ],
    };
  };

  const result = await resolveIosAppStateFromSnapshots(
    iosSimulator,
    '/tmp/daemon.log',
    undefined,
    {} as CommandFlags,
    fakeDispatch,
  );

  assert.deepEqual(backends, ['xctest']);
  assert.equal(result.source, 'snapshot-xctest');
  assert.equal(result.appBundleId, 'com.apple.Preferences');
});

test('appstate falls back to ax on simulator when xctest is empty', async () => {
  const backends: string[] = [];
  const fakeDispatch: typeof dispatchCommand = async (_device, _command, _positionals, _outPath, context) => {
    const backend = context?.snapshotBackend ?? 'unknown';
    backends.push(backend);
    if (backend === 'xctest') {
      return { nodes: [] };
    }
    return {
      nodes: [
        {
          type: 'AXApplication',
          label: 'Calculator',
          identifier: 'com.apple.calculator',
        },
      ],
    };
  };

  const result = await resolveIosAppStateFromSnapshots(
    iosSimulator,
    '/tmp/daemon.log',
    undefined,
    {} as CommandFlags,
    fakeDispatch,
  );

  assert.deepEqual(backends, ['xctest', 'ax']);
  assert.equal(result.source, 'snapshot-ax');
  assert.equal(result.appBundleId, 'com.apple.calculator');
});

test('appstate does not try ax on iOS device', async () => {
  const backends: string[] = [];
  const fakeDispatch: typeof dispatchCommand = async (_device, _command, _positionals, _outPath, context) => {
    backends.push(context?.snapshotBackend ?? 'unknown');
    return { nodes: [] };
  };

  const result = await resolveIosAppStateFromSnapshots(
    iosDevice,
    '/tmp/daemon.log',
    undefined,
    {} as CommandFlags,
    fakeDispatch,
  );

  assert.deepEqual(backends, ['xctest']);
  assert.equal(result.source, 'snapshot-xctest');
  assert.equal(result.appName, 'unknown');
});
