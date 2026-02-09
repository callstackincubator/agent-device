import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('writeSessionLog writes .ad only when recording is enabled', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-disabled-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const files = fs.readdirSync(root);
  assert.equal(files.filter((file) => file.endsWith('.ad')).length, 0);
});

test('saveScript flag enables .ad session log writing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-enabled-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const files = fs.readdirSync(root);
  assert.equal(files.filter((file) => file.endsWith('.ad')).length, 1);
});
