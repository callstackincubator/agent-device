import { test, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../session-store.ts';
import { resolveEffectiveSessionName } from '../session-routing.ts';
import type { SessionState } from '../types.ts';

function makeSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel',
      kind: 'emulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
}

function makeStore(t: TestContext): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-routing-'));
  t.onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });
  return new SessionStore(path.join(root, 'sessions'));
}

test('reuses lone active session for implicit default session', (t) => {
  const store = makeStore(t);
  store.set('android', makeSession('android'));

  const resolved = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['com.google.android.apps.maps'],
      flags: {},
    },
    store,
  );

  assert.equal(resolved, 'android');
});

test('keeps requested default when explicit --session is provided', (t) => {
  const store = makeStore(t);
  store.set('android', makeSession('android'));

  const resolved = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['com.google.android.apps.maps'],
      flags: { session: 'default' },
    },
    store,
  );

  assert.equal(resolved, 'default');
});

test('keeps requested non-default session names', (t) => {
  const store = makeStore(t);
  store.set('android', makeSession('android'));

  const resolved = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'maps-test',
      command: 'open',
      positionals: ['com.google.android.apps.maps'],
      flags: {},
    },
    store,
  );

  assert.equal(resolved, 'maps-test');
});

test('does not reuse when multiple sessions are active', (t) => {
  const store = makeStore(t);
  store.set('android', makeSession('android'));
  store.set('ios', {
    ...makeSession('ios'),
    device: {
      platform: 'ios',
      id: 'ios-sim',
      name: 'iPhone',
      kind: 'simulator',
      booted: true,
    },
  });

  const resolved = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['com.google.android.apps.maps'],
      flags: {},
    },
    store,
  );

  assert.equal(resolved, 'default');
});
