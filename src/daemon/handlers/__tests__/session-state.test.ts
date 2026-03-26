import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { handleSessionStateCommands } from '../session-state.ts';
import { SessionStore } from '../../session-store.ts';

function makeStore(): SessionStore {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-state-'));
  return new SessionStore(path.join(tempRoot, 'sessions'));
}

test('boot rejects --headless outside Android directly', async () => {
  const response = await handleSessionStateCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'boot',
      positionals: [],
      flags: { platform: 'ios', headless: true },
    },
    sessionName: 'default',
    sessionStore: makeStore(),
    ensureReady: async () => {},
    resolveDevice: async () => {
      throw new Error('resolveDevice should not run for invalid headless iOS boot');
    },
    ensureAndroidEmulatorBoot: async () => {
      throw new Error('ensureAndroidEmulatorBoot should not run for invalid headless iOS boot');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /supported only for Android emulators/i);
  }
});

test('appstate returns missing-session error for explicit session flag', async () => {
  const response = await handleSessionStateCommands({
    req: {
      token: 't',
      session: 'named',
      command: 'appstate',
      positionals: [],
      flags: { platform: 'ios', session: 'named' },
    },
    sessionName: 'named',
    sessionStore: makeStore(),
    ensureReady: async () => {},
    resolveDevice: async () => {
      throw new Error('resolveDevice should not run when explicit session is missing');
    },
    ensureAndroidEmulatorBoot: async () => {
      throw new Error('ensureAndroidEmulatorBoot should not run for appstate');
    },
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'SESSION_NOT_FOUND');
    assert.match(response.error.message, /Run open with --session named first/i);
  }
});
