import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfiguredSessionBinding } from '../session-binding.ts';

test('applies AGENT_DEVICE_PLATFORM when command flags omit platform', () => {
  const flags = applyConfiguredSessionBinding<{
    platform?: 'ios' | 'android' | 'apple';
  }>('open', {}, {
    AGENT_DEVICE_PLATFORM: 'android',
  });
  assert.equal(flags.platform, 'android');
});

test('rejects conflicting platform override in session-locked mode', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('snapshot', { platform: 'android' }, {
      AGENT_DEVICE_PLATFORM: 'ios',
      AGENT_DEVICE_SESSION_LOCKED: '1',
    }),
    /snapshot cannot override session-locked device binding with --platform=android/i,
  );
});

test('rejects explicit device selectors in session-locked mode', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('open', { device: 'iPhone 16', udid: 'SIM-001' }, {
      AGENT_DEVICE_PLATFORM: 'ios',
      AGENT_DEVICE_SESSION_LOCKED: 'true',
    }),
    /--device=iPhone 16, --udid=SIM-001/i,
  );
});

test('rejects target retargeting in session-locked mode', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('open', { target: 'tv' }, {
      AGENT_DEVICE_PLATFORM: 'ios',
      AGENT_DEVICE_SESSION_LOCKED: '1',
    }),
    /--target=tv/i,
  );
});

test('strip mode preserves configured platform and removes explicit device selectors', () => {
  const flags = applyConfiguredSessionBinding('open', {
    platform: 'android',
    target: 'tv',
    device: 'Pixel 9',
    serial: 'emulator-5554',
  }, {
    AGENT_DEVICE_PLATFORM: 'ios',
    AGENT_DEVICE_SESSION_LOCKED: '1',
    AGENT_DEVICE_SESSION_LOCK_CONFLICTS: 'strip',
  });

  assert.equal(flags.platform, 'ios');
  assert.equal(flags.target, undefined);
  assert.equal(flags.device, undefined);
  assert.equal(flags.serial, undefined);
});
