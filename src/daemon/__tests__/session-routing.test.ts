import { test, type TestContext } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../session-store.ts';
import {
  resolveEffectiveSessionName,
  resolveImplicitSessionScope,
  sessionMatchesScope,
} from '../session-routing.ts';
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

test('does not reuse lone active session for implicit default session from another scope', (t) => {
  const store = makeStore(t);
  store.set('android', makeSession('android'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-cwd-scope-'));
  t.onTestFinished(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const resolved = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'open',
      positionals: ['com.google.android.apps.maps'],
      flags: {},
      meta: { cwd },
    },
    store,
  );

  assert.match(resolved, /^cwd:[a-f0-9]{16}:default$/);
  assert.notEqual(resolved, 'android');
});

test('uses git worktree root for implicit default session scope', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-cwd-scope-'));
  const nested = path.join(root, 'packages', 'app');
  fs.mkdirSync(path.join(root, '.git'));
  fs.mkdirSync(nested, { recursive: true });
  t.onTestFinished(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const store = makeStore(t);
  const fromRoot = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'snapshot',
      positionals: [],
      flags: {},
      meta: { cwd: root },
    },
    store,
  );
  const fromNested = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'snapshot',
      positionals: [],
      flags: {},
      meta: { cwd: nested },
    },
    store,
  );

  assert.equal(fromNested, fromRoot);
});

test('keeps explicitly configured default session global', (t) => {
  const store = makeStore(t);
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-cwd-scope-'));
  t.onTestFinished(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  const resolved = resolveEffectiveSessionName(
    {
      token: 't',
      session: 'default',
      command: 'snapshot',
      positionals: [],
      flags: {},
      meta: { cwd, sessionExplicit: true },
    },
    store,
  );

  assert.equal(resolved, 'default');
});

test('matches sessions only within the same implicit scope', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-cwd-scope-'));
  t.onTestFinished(() => {
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const req = {
    token: 't',
    session: 'default',
    command: 'session_list',
    positionals: [],
    flags: {},
    meta: { cwd },
  };
  const scope = resolveImplicitSessionScope(req);
  assert.ok(scope);

  assert.equal(
    sessionMatchesScope({ ...makeSession('default'), sessionScope: scope }, scope),
    true,
  );
  assert.equal(
    sessionMatchesScope(
      { ...makeSession('default'), sessionScope: { kind: 'cwd', id: 'other' } },
      scope,
    ),
    false,
  );
});
