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
  const calls: Array<{ snapshotDepth?: number; snapshotCompact?: boolean }> = [];
  const fakeDispatch: typeof dispatchCommand = async (_device, _command, _positionals, _outPath, context) => {
    calls.push({ snapshotDepth: context?.snapshotDepth, snapshotCompact: context?.snapshotCompact });
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

  assert.deepEqual(calls, [{ snapshotDepth: 1, snapshotCompact: true }]);
  assert.equal(result.source, 'snapshot-xctest');
  assert.equal(result.appBundleId, 'com.apple.Preferences');
});

test('appstate resolves on iOS device when xctest succeeds', async () => {
  const calls: Array<{ snapshotDepth?: number; snapshotCompact?: boolean }> = [];
  const fakeDispatch: typeof dispatchCommand = async (_device, _command, _positionals, _outPath, context) => {
    calls.push({ snapshotDepth: context?.snapshotDepth, snapshotCompact: context?.snapshotCompact });
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
    iosDevice,
    '/tmp/daemon.log',
    undefined,
    {} as CommandFlags,
    fakeDispatch,
  );

  assert.deepEqual(calls, [{ snapshotDepth: 1, snapshotCompact: true }]);
  assert.equal(result.source, 'snapshot-xctest');
  assert.equal(result.appName, 'Settings');
});

test('appstate fails on simulator when xctest is empty', async () => {
  const fakeDispatch: typeof dispatchCommand = async () => {
    return { nodes: [] };
  };

  await assert.rejects(
    resolveIosAppStateFromSnapshots(
      iosSimulator,
      '/tmp/daemon.log',
      undefined,
      {} as CommandFlags,
      fakeDispatch,
    ),
    /0 nodes or missing application node/,
  );
});

test('appstate fails on simulator when xctest throws', async () => {
  const fakeDispatch: typeof dispatchCommand = async () => {
    throw new Error('xctest failed');
  };

  await assert.rejects(
    resolveIosAppStateFromSnapshots(
      iosSimulator,
      '/tmp/daemon.log',
      undefined,
      {} as CommandFlags,
      fakeDispatch,
    ),
    /Unable to resolve iOS app state from XCTest snapshot/,
  );
});

test('appstate fails on device when xctest throws', async () => {
  const fakeDispatch: typeof dispatchCommand = async () => {
    throw new Error('xctest failed');
  };

  await assert.rejects(
    resolveIosAppStateFromSnapshots(
      iosDevice,
      '/tmp/daemon.log',
      undefined,
      {} as CommandFlags,
      fakeDispatch,
    ),
    /Unable to resolve iOS app state from XCTest snapshot/,
  );
});
