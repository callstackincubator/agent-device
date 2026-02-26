import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSerialAllowlist,
  resolveAndroidSerialAllowlist,
  resolveIosSimulatorDeviceSetPath,
} from '../device-isolation.ts';

test('resolveIosSimulatorDeviceSetPath prefers CLI flag over env', () => {
  const value = resolveIosSimulatorDeviceSetPath('/tmp/flag-set', {
    AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET: '/tmp/agent-set',
    IOS_SIMULATOR_DEVICE_SET: '/tmp/compat-set',
  });
  assert.equal(value, '/tmp/flag-set');
});

test('resolveIosSimulatorDeviceSetPath falls back to AGENT_DEVICE env first', () => {
  const value = resolveIosSimulatorDeviceSetPath(undefined, {
    AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET: '/tmp/agent-set',
    IOS_SIMULATOR_DEVICE_SET: '/tmp/compat-set',
  });
  assert.equal(value, '/tmp/agent-set');
});

test('parseSerialAllowlist splits comma and whitespace separators', () => {
  const parsed = parseSerialAllowlist('emulator-5554, device-1234\nemulator-7777');
  assert.deepEqual(Array.from(parsed).sort(), ['device-1234', 'emulator-5554', 'emulator-7777']);
});

test('resolveAndroidSerialAllowlist resolves from CLI and env', () => {
  const flag = resolveAndroidSerialAllowlist(' emulator-5554 , device-1234 ');
  assert.deepEqual(Array.from(flag ?? []).sort(), ['device-1234', 'emulator-5554']);

  const env = resolveAndroidSerialAllowlist(undefined, {
    AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST: 'emulator-7777',
  });
  assert.deepEqual(Array.from(env ?? []), ['emulator-7777']);
});
