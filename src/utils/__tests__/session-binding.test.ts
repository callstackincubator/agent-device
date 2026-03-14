import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfiguredSessionBinding, resolveBindingSettings } from '../session-binding.ts';

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

test('default session binding implies reject-mode locking by convention', () => {
  const binding = resolveBindingSettings({
    env: {
      AGENT_DEVICE_SESSION: 'qa-ios',
      AGENT_DEVICE_PLATFORM: 'ios',
    } as NodeJS.ProcessEnv,
  });
  assert.equal(binding.defaultPlatform, 'ios');
  assert.equal(binding.lockPolicy, 'reject');
});

test('single session lock env enables strip mode by convention', () => {
  const binding = resolveBindingSettings({
    env: {
      AGENT_DEVICE_SESSION: 'qa-android',
      AGENT_DEVICE_PLATFORM: 'android',
      AGENT_DEVICE_SESSION_LOCK: 'strip',
    } as NodeJS.ProcessEnv,
  });
  assert.equal(binding.defaultPlatform, 'android');
  assert.equal(binding.lockPolicy, 'strip');
});

test('policy overrides take precedence over environment lock settings', () => {
  const binding = resolveBindingSettings({
    env: {
      AGENT_DEVICE_PLATFORM: 'ios',
      AGENT_DEVICE_SESSION_LOCKED: '0',
      AGENT_DEVICE_SESSION_LOCK_CONFLICTS: 'reject',
    } as NodeJS.ProcessEnv,
    policyOverrides: {
      sessionLock: 'strip',
    },
  });

  assert.equal(binding.defaultPlatform, 'ios');
  assert.equal(binding.lockPolicy, 'strip');
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
