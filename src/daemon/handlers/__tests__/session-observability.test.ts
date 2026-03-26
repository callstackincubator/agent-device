import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handleSessionObservabilityCommands } from '../session-observability.ts';
import { SessionStore } from '../../session-store.ts';

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-observability-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

test('logs path reports backend for macOS desktop sessions directly', async () => {
  const sessionStore = makeStore();
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
  const sessionStore = makeStore();
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
