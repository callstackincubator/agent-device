import test from 'node:test';
import assert from 'node:assert/strict';
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

function makeStore(): SessionStore {
  return new SessionStore(path.join(os.tmpdir(), 'agent-device-session-routing-tests'));
}

test('reuses lone active session for implicit default session', () => {
  const store = makeStore();
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

test('keeps requested default when explicit --session is provided', () => {
  const store = makeStore();
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

test('keeps requested non-default session names', () => {
  const store = makeStore();
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

test('does not reuse when multiple sessions are active', () => {
  const store = makeStore();
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
