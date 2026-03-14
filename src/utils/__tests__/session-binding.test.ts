import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfiguredSessionBinding } from '../session-binding.ts';

test('applies AGENT_DEVICE_PLATFORM when command flags omit platform', () => {
  const flags = applyConfiguredSessionBinding<{
    platform?: 'ios' | 'android' | 'apple';
  }>('open', {}, {
    env: {
      AGENT_DEVICE_PLATFORM: 'android',
    } as NodeJS.ProcessEnv,
  });
  assert.equal(flags.platform, 'android');
});

test('rejects conflicting platform override in session-locked mode', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('snapshot', { platform: 'android' }, {
      env: {
        AGENT_DEVICE_PLATFORM: 'ios',
        AGENT_DEVICE_SESSION_LOCKED: '1',
      } as NodeJS.ProcessEnv,
    }),
    /snapshot cannot override session-locked device binding with --platform=android/i,
  );
});

test('rejects explicit platform in session-locked mode without configured default', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('snapshot', { platform: 'android' }, {
      env: {} as NodeJS.ProcessEnv,
      policyOverrides: {
        sessionLocked: true,
      },
    }),
    /--platform=android/i,
  );
});

test('rejects explicit device selectors in session-locked mode', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('open', { device: 'iPhone 16', udid: 'SIM-001' }, {
      env: {
        AGENT_DEVICE_PLATFORM: 'ios',
        AGENT_DEVICE_SESSION_LOCKED: 'true',
      } as NodeJS.ProcessEnv,
    }),
    /--device=iPhone 16, --udid=SIM-001/i,
  );
});

test('rejects target retargeting in session-locked mode', () => {
  assert.throws(
    () => applyConfiguredSessionBinding('open', { target: 'tv' }, {
      env: {
        AGENT_DEVICE_PLATFORM: 'ios',
        AGENT_DEVICE_SESSION_LOCKED: '1',
      } as NodeJS.ProcessEnv,
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
    env: {
      AGENT_DEVICE_PLATFORM: 'ios',
      AGENT_DEVICE_SESSION_LOCKED: '1',
      AGENT_DEVICE_SESSION_LOCK_CONFLICTS: 'strip',
    } as NodeJS.ProcessEnv,
  });

  assert.equal(flags.platform, 'ios');
  assert.equal(flags.target, undefined);
  assert.equal(flags.device, undefined);
  assert.equal(flags.serial, undefined);
});

test('policy overrides take precedence over environment lock settings', () => {
  const flags = applyConfiguredSessionBinding<{
    platform?: 'ios' | 'android' | 'apple';
    device?: string;
  }>('snapshot', { device: 'Pixel 9' }, {
    env: {
      AGENT_DEVICE_PLATFORM: 'ios',
      AGENT_DEVICE_SESSION_LOCKED: '0',
      AGENT_DEVICE_SESSION_LOCK_CONFLICTS: 'reject',
    } as NodeJS.ProcessEnv,
    policyOverrides: {
      sessionLocked: true,
      sessionLockConflicts: 'strip',
    },
  });

  assert.equal(flags.platform, 'ios');
  assert.equal(flags.device, undefined);
});

test('inherited platform takes precedence over env default for batch-style step normalization', () => {
  const flags = applyConfiguredSessionBinding<{
    platform?: 'ios' | 'android' | 'apple';
  }>('batch step 1 (snapshot)', {}, {
    env: {
      AGENT_DEVICE_PLATFORM: 'ios',
    } as NodeJS.ProcessEnv,
    inheritedPlatform: 'android',
  });

  assert.equal(flags.platform, 'android');
});
