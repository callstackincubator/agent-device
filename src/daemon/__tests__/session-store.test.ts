import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../session-store.ts';
import type { SessionState } from '../types.ts';

function makeSession(name: string): SessionState {
  return {
    name,
    device: {
      platform: 'ios',
      id: 'sim-1',
      name: 'iPhone',
      kind: 'simulator',
      booted: true,
    },
    createdAt: Date.now(),
    actions: [],
  };
}

test('recordAction stores normalized action entries', () => {
  const store = new SessionStore(path.join(os.tmpdir(), 'agent-device-tests'));
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'snapshot',
    positionals: [],
    flags: { platform: 'ios', snapshotInteractiveOnly: true, verbose: true },
    result: { nodes: 1 },
  });
  assert.equal(session.actions.length, 1);
  assert.equal(session.actions[0].command, 'snapshot');
  assert.equal(session.actions[0].flags.platform, 'ios');
  assert.equal(session.actions[0].flags.snapshotInteractiveOnly, true);
});

test('recordAction skips entries marked noRecord', () => {
  const store = new SessionStore(path.join(os.tmpdir(), 'agent-device-tests'));
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'click',
    positionals: ['@e1'],
    flags: { noRecord: true },
    result: {},
  });
  assert.equal(session.actions.length, 0);
});

test('defaultTracePath sanitizes session name', () => {
  const store = new SessionStore(path.join(os.tmpdir(), 'agent-device-tests'));
  const session = makeSession('session with spaces');
  const tracePath = store.defaultTracePath(session);
  assert.match(tracePath, /session_with_spaces/);
  assert.match(tracePath, /\.trace\.log$/);
});
