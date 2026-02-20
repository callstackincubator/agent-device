import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDiffSnapshotResponse, handleSnapshotCommands } from '../snapshot.ts';
import type { SnapshotState } from '../../../utils/snapshot.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-snapshot-handler-'));
  return new SessionStore(path.join(root, 'sessions'));
}

function makeSession(name: string, device: SessionState['device']): SessionState {
  return {
    name,
    device,
    createdAt: Date.now(),
    actions: [],
  };
}

test('snapshot rejects @ref scope without existing session snapshot', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-1',
      name: 'My iPhone Simulator',
      kind: 'simulator',
      booted: true,
    }),
  );

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'snapshot',
      positionals: [],
      flags: { snapshotScope: '@e1' },
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /requires an existing snapshot/i);
  }
});

test('settings rejects unsupported iOS physical devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'ios-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'settings',
      positionals: ['wifi', 'on'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'UNSUPPORTED_OPERATION');
    assert.match(response.error.message, /settings is not supported/i);
  }
});

test('settings usage hint documents canonical faceid states', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'settings',
      positionals: [],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /match\|nonmatch\|enroll\|unenroll/);
    assert.doesNotMatch(response.error.message, /validate\|unvalidate/);
  }
});

test('diff rejects unsupported kind', async () => {
  const sessionStore = makeSessionStore();
  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: 'default',
      command: 'diff',
      positionals: ['screenshot'],
      flags: {},
    },
    sessionName: 'default',
    logPath: '/tmp/daemon.log',
    sessionStore,
  });

  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /supports only: snapshot/i);
  }
});

test('buildDiffSnapshotResponse initializes baseline when previous snapshot is missing', () => {
  const current: SnapshotState = {
    nodes: [{ index: 0, ref: 'e1', label: 'Sign Up', type: 'heading', depth: 0 }],
    createdAt: Date.now(),
    backend: 'xctest',
  };
  const data = buildDiffSnapshotResponse(undefined, current);
  assert.equal(data.baselineInitialized, true);
  assert.deepEqual(data.summary, { additions: 0, removals: 0, unchanged: 1 });
  assert.deepEqual(data.lines, []);
});

test('buildDiffSnapshotResponse returns additions/removals on changed snapshot', () => {
  const previous: SnapshotState = {
    nodes: [
      { index: 0, ref: 'e1', label: 'Sign Up', type: 'heading', depth: 0 },
      { index: 1, ref: 'e2', label: 'Submit', type: 'button', depth: 0, enabled: true },
    ],
    createdAt: Date.now() - 100,
    backend: 'xctest',
  };
  const current: SnapshotState = {
    nodes: [
      { index: 0, ref: 'e1', label: 'Sign Up', type: 'heading', depth: 0 },
      { index: 1, ref: 'e2', label: 'Submit', type: 'button', depth: 0, enabled: false },
      { index: 2, ref: 'e3', label: 'Sending...', type: 'status', depth: 0 },
    ],
    createdAt: Date.now(),
    backend: 'xctest',
  };
  const data = buildDiffSnapshotResponse(previous, current);
  assert.equal(data.baselineInitialized, false);
  assert.equal(data.summary.additions, 2);
  assert.equal(data.summary.removals, 1);
  assert.equal(data.summary.unchanged, 1);
  assert.ok(data.lines.some((line) => line.kind === 'added'));
  assert.ok(data.lines.some((line) => line.kind === 'removed'));
});
