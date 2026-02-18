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

test('saveScript path writes session log to custom location', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-custom-path-'));
  const store = new SessionStore(path.join(root, 'sessions'));
  const session = makeSession('default');
  const customPath = path.join(root, 'workflows', 'my-flow.ad');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: customPath },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  assert.equal(fs.existsSync(customPath), true);
  assert.equal(fs.existsSync(path.join(root, 'sessions')), false);
});

test('writeSessionLog persists open --relaunch in script output', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-relaunch-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true, relaunch: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const scriptFile = fs.readdirSync(root).find((file) => file.endsWith('.ad'));
  assert.ok(scriptFile);
  const script = fs.readFileSync(path.join(root, scriptFile!), 'utf8');
  assert.match(script, /open "Settings" --relaunch/);
});

test('writeSessionLog preserves interaction series flags for click/press/swipe', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-log-series-flags-'));
  const store = new SessionStore(root);
  const session = makeSession('default');
  store.recordAction(session, {
    command: 'open',
    positionals: ['Settings'],
    flags: { platform: 'ios', saveScript: true },
    result: {},
  });
  store.recordAction(session, {
    command: 'click',
    positionals: ['id="continue_button"'],
    flags: {
      platform: 'ios',
      count: 5,
      intervalMs: 1,
      holdMs: 2,
      jitterPx: 3,
      doubleTap: true,
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'press',
    positionals: ['201', '545'],
    flags: {
      platform: 'ios',
      count: 4,
      intervalMs: 8,
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'swipe',
    positionals: ['10', '20', '30', '40'],
    flags: {
      platform: 'ios',
      count: 3,
      pauseMs: 12,
      pattern: 'ping-pong',
    },
    result: {},
  });
  store.recordAction(session, {
    command: 'close',
    positionals: [],
    flags: { platform: 'ios' },
    result: {},
  });

  store.writeSessionLog(session);
  const scriptFile = fs.readdirSync(root).find((file) => file.endsWith('.ad'));
  assert.ok(scriptFile);
  const script = fs.readFileSync(path.join(root, scriptFile!), 'utf8');
  assert.match(script, /click "id=\\"continue_button\\"" --count 5 --interval-ms 1 --hold-ms 2 --jitter-px 3 --double-tap/);
  assert.match(script, /press 201 545 --count 4 --interval-ms 8/);
  assert.match(script, /swipe 10 20 30 40 --count 3 --pause-ms 12 --pattern ping-pong/);
});
