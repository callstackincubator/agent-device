import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleSnapshotCommands } from '../snapshot.ts';
import { SessionStore } from '../../session-store.ts';
import type { SessionState } from '../../types.ts';
import { AppError } from '../../../utils/errors.ts';

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
    assert.match(response.error.message, /appearance <light\|dark\|toggle>/);
    assert.match(response.error.message, /match\|nonmatch\|enroll\|unenroll/);
    assert.match(response.error.message, /grant\|deny\|reset/);
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
      positionals: ['unknown'],
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
    assert.match(response.error.message, /diff.*supports.*snapshot/i);
  }
});

test('diff screenshot is not handled daemon-side (client-backed command)', async () => {
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

  // diff screenshot is a client-backed command, so the daemon rejects it
  // as an unknown diff subcommand
  assert.ok(response);
  assert.equal(response?.ok, false);
  if (response && !response.ok) {
    assert.equal(response.error.code, 'INVALID_ARGS');
    assert.match(response.error.message, /diff.*supports.*snapshot/i);
  }
});

test('diff initializes baseline on first run and updates it for subsequent runs', async () => {
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

  let snapshotCall = 0;
  const dispatchSnapshotCommand = async () => {
    snapshotCall += 1;
    if (snapshotCall === 1) {
      return {
        nodes: [
          { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
          { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: '67' },
        ],
        truncated: false,
        backend: 'xctest' as const,
      };
    }
    return {
      nodes: [
        { index: 0, depth: 0, type: 'XCUIElementTypeWindow' },
        { index: 1, depth: 1, type: 'XCUIElementTypeStaticText', label: '134' },
      ],
      truncated: false,
      backend: 'xctest' as const,
    };
  };

  const first = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'diff',
      positionals: ['snapshot'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    dispatchSnapshotCommand: dispatchSnapshotCommand as any,
  });

  assert.ok(first);
  assert.equal(first?.ok, true);
  if (first && first.ok) {
    assert.equal((first.data as any).baselineInitialized, true);
    assert.deepEqual((first.data as any).lines, []);
  }
  const baselineSession = sessionStore.get(sessionName);
  assert.ok(baselineSession?.snapshot);
  assert.equal(baselineSession?.snapshot?.nodes[1]?.label, '67');

  const second = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'diff',
      positionals: ['snapshot'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    dispatchSnapshotCommand: dispatchSnapshotCommand as any,
  });

  assert.ok(second);
  assert.equal(second?.ok, true);
  if (second && second.ok) {
    assert.equal((second.data as any).baselineInitialized, false);
    assert.equal((second.data as any).summary.additions, 1);
    assert.equal((second.data as any).summary.removals, 1);
  }
  const updatedSession = sessionStore.get(sessionName);
  assert.equal(updatedSession?.snapshot?.nodes[1]?.label, '134');
});

const iosSimulatorDevice: SessionState['device'] = {
  platform: 'ios',
  id: 'sim-1',
  name: 'My iPhone Simulator',
  kind: 'simulator',
  booted: true,
};

test('alert accept retries on "alert not found" and succeeds on second attempt', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  const runnerCommand = async () => {
    calls += 1;
    if (calls === 1) throw new AppError('COMMAND_FAILED', 'alert not found');
    return { accepted: true };
  };

  const response = await handleSnapshotCommands({
    req: { token: 't', session: sessionName, command: 'alert', positionals: ['accept'], flags: {} },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    runnerCommand: runnerCommand as any,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(calls, 2);
});

test('alert accept does not retry on non-alert errors', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  const runnerCommand = async () => {
    calls += 1;
    throw new AppError('COMMAND_FAILED', 'runner crashed');
  };

  await assert.rejects(
    () =>
      handleSnapshotCommands({
        req: {
          token: 't',
          session: sessionName,
          command: 'alert',
          positionals: ['accept'],
          flags: {},
        },
        sessionName,
        logPath: '/tmp/daemon.log',
        sessionStore,
        runnerCommand: runnerCommand as any,
      }),
    (err: unknown) => err instanceof AppError && err.message === 'runner crashed',
  );

  assert.equal(calls, 1);
});

test('alert dismiss retries on "no alert" message', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  const runnerCommand = async () => {
    calls += 1;
    if (calls < 3) throw new AppError('COMMAND_FAILED', 'no alert present');
    return { dismissed: true };
  };

  const response = await handleSnapshotCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'alert',
      positionals: ['dismiss'],
      flags: {},
    },
    sessionName,
    logPath: '/tmp/daemon.log',
    sessionStore,
    runnerCommand: runnerCommand as any,
  });

  assert.ok(response);
  assert.equal(response?.ok, true);
  assert.equal(calls, 3);
});

test('alert get does not retry on failure', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-sim';
  sessionStore.set(sessionName, makeSession(sessionName, iosSimulatorDevice));

  let calls = 0;
  const runnerCommand = async () => {
    calls += 1;
    throw new AppError('COMMAND_FAILED', 'alert not found');
  };

  await assert.rejects(() =>
    handleSnapshotCommands({
      req: { token: 't', session: sessionName, command: 'alert', positionals: ['get'], flags: {} },
      sessionName,
      logPath: '/tmp/daemon.log',
      sessionStore,
      runnerCommand: runnerCommand as any,
    }),
  );

  assert.equal(calls, 1);
});
