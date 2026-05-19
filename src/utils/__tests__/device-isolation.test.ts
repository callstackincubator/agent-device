import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  parseSerialAllowlist,
  resolveAndroidSerialAllowlist,
  resolveIosSimulatorDeviceSetPath,
} from '../device-isolation.ts';

test('resolveIosSimulatorDeviceSetPath resolves CLI flag value only', () => {
  const value = resolveIosSimulatorDeviceSetPath('/tmp/flag-set');
  assert.equal(value, '/tmp/flag-set');
});

test('resolveIosSimulatorDeviceSetPath ignores missing CLI flag value', () => {
  const value = resolveIosSimulatorDeviceSetPath(undefined);
  assert.equal(value, undefined);
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
