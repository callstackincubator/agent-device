import assert from 'node:assert/strict';
import { test } from 'vitest';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';
import { handleSessionObservabilityCommands } from '../session-observability.ts';

test('network dump validates include mode directly', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'network',
      positionals: ['dump', '5', 'invalid-mode'],
      flags: {},
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /network include mode must be one of/i);
  }
});

test('network dump accepts explicit include flag and rejects conflicting values', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('android', {
    name: 'android',
    createdAt: Date.now(),
    actions: [],
    appBundleId: 'com.example.app',
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
  });

  const okResponse = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'network',
      positionals: ['dump', '5'],
      flags: { networkInclude: 'headers' },
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(okResponse);
  assert.equal(okResponse?.ok, true);
  if (okResponse?.ok) {
    assert.equal(okResponse.data?.include, 'headers');
  }

  const conflictResponse = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'android',
      command: 'network',
      positionals: ['dump', '5', 'summary'],
      flags: { networkInclude: 'headers' },
    },
    sessionName: 'android',
    sessionStore,
  });

  assert.ok(conflictResponse);
  assert.equal(conflictResponse?.ok, false);
  if (conflictResponse && !conflictResponse.ok) {
    assert.equal(conflictResponse.error.code, 'INVALID_ARGS');
    assert.match(conflictResponse.error.message, /both positionally and via --include/i);
  }
});
