import { test } from 'vitest';
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

test('resolveIosSimulatorDeviceSetPath falls back to AGENT_DEVICE env before compat env', () => {
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

test('resolveAndroidSerialAllowlist prefers CLI value and falls back to env', () => {
  const fromFlag = resolveAndroidSerialAllowlist(' emulator-5554 , device-1234 ');
  assert.deepEqual(Array.from(fromFlag ?? []).sort(), ['device-1234', 'emulator-5554']);

  const fromEnv = resolveAndroidSerialAllowlist(undefined, {
    AGENT_DEVICE_ANDROID_DEVICE_ALLOWLIST: 'emulator-7777',
  });
  assert.deepEqual(Array.from(fromEnv ?? []), ['emulator-7777']);
});
