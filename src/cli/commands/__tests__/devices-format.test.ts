import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatDeviceLine } from '../devices.ts';
import type { AgentDeviceDevice } from '../../../client.ts';

test('formatDeviceLine shows hdc serial for harmonyos devices', () => {
  const device: AgentDeviceDevice = {
    platform: 'harmonyos',
    id: '22M0223824043030',
    name: '22M0223824043030',
    kind: 'device',
    target: 'mobile',
    booted: true,
  };
  assert.equal(
    formatDeviceLine(device),
    '22M0223824043030 (harmonyos device target=mobile) booted=true',
  );
});

test('formatDeviceLine keeps human-readable name for other platforms', () => {
  const device: AgentDeviceDevice = {
    platform: 'android',
    id: 'emulator-5554',
    name: 'Pixel 9',
    kind: 'emulator',
    target: 'mobile',
    booted: true,
  };
  assert.equal(formatDeviceLine(device), 'Pixel 9 (android emulator target=mobile) booted=true');
});
