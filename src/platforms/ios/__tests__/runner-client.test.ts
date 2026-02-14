import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeviceInfo } from '../../../utils/device.ts';
import {
  resolveRunnerBuildDestination,
  resolveRunnerDestination,
  resolveRunnerSigningBuildSettings,
} from '../runner-client.ts';

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

test('resolveRunnerDestination uses simulator destination for simulators', () => {
  assert.equal(resolveRunnerDestination(iosSimulator), 'platform=iOS Simulator,id=sim-1');
});

test('resolveRunnerDestination uses device destination for physical devices', () => {
  assert.equal(
    resolveRunnerDestination(iosDevice),
    'platform=iOS,id=00008110-000E12341234002E',
  );
});

test('resolveRunnerBuildDestination uses generic iOS destination for physical devices', () => {
  assert.equal(resolveRunnerBuildDestination(iosDevice), 'generic/platform=iOS');
});

test('resolveRunnerSigningBuildSettings returns empty args without env overrides', () => {
  assert.deepEqual(resolveRunnerSigningBuildSettings({}), []);
});

test('resolveRunnerSigningBuildSettings enables automatic signing for device builds without forcing identity', () => {
  assert.deepEqual(resolveRunnerSigningBuildSettings({}, true), [
    'CODE_SIGN_STYLE=Automatic',
  ]);
});

test('resolveRunnerSigningBuildSettings applies optional overrides when provided', () => {
  const settings = resolveRunnerSigningBuildSettings({
    AGENT_DEVICE_IOS_TEAM_ID: 'ABCDE12345',
    AGENT_DEVICE_IOS_SIGNING_IDENTITY: 'Apple Development',
    AGENT_DEVICE_IOS_PROVISIONING_PROFILE: 'My Profile',
  }, true);
  assert.deepEqual(settings, [
    'CODE_SIGN_STYLE=Automatic',
    'DEVELOPMENT_TEAM=ABCDE12345',
    'CODE_SIGN_IDENTITY=Apple Development',
    'PROVISIONING_PROFILE_SPECIFIER=My Profile',
  ]);
});
