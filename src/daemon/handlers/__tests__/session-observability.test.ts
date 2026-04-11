import assert from 'node:assert/strict';
import { test } from 'vitest';
import { handleSessionObservabilityCommands } from '../session-observability.ts';
import { makeSessionStore } from '../../../__tests__/test-utils/store-factory.ts';

test('logs path reports backend for macOS desktop sessions directly', async () => {
  const sessionStore = makeSessionStore('agent-device-session-observability-');
  sessionStore.set('desktop', {
    name: 'desktop',
    createdAt: Date.now(),
    actions: [],
    surface: 'desktop',
    device: {
      platform: 'macos',
      id: 'host-mac',
      name: 'Host Mac',
      kind: 'device',
      target: 'desktop',
    },
  });

  const response = await handleSessionObservabilityCommands({
    req: {
      token: 't',
      session: 'desktop',
      command: 'logs',
      positionals: ['path'],
      flags: {},
    },
    sessionName: 'desktop',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  if (response?.ok) {
    assert.equal(response.data?.backend, 'macos');
    assert.equal(response.data?.active, false);
  }
});

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
