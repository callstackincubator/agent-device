import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionAction, SessionState } from '../../types.ts';
import type { DeviceInfo } from '../../../utils/device.ts';

function makeDevice(): DeviceInfo {
  return {
    platform: 'ios',
    id: 'sim-1',
    name: 'iPhone Test',
    kind: 'simulator',
    booted: true,
  };
}

function makeSession(name: string): SessionState {
  return {
    name,
    device: makeDevice(),
    createdAt: Date.now(),
    appBundleId: 'com.example.app',
    actions: [],
  };
}

function writeReplayFile(filePath: string, action: SessionAction) {
  const payload = {
    optimizedActions: [action],
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function readReplaySelector(filePath: string, command: string): string {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8')) as {
    optimizedActions?: Array<{ command?: string; positionals?: string[] }>;
  };
  const action = payload.optimizedActions?.find((entry) => entry.command === command);
  if (!action) return '';
  if (command === 'is') {
    return action.positionals?.[1] ?? '';
  }
  return action.positionals?.[0] ?? '';
}

test('replay --update heals selector and rewrites replay file', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.json');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'click',
    positionals: ['id="old_continue"'],
    flags: {},
    result: {
      refLabel: 'Continue',
      selectorChain: ['id="old_continue"', 'label="Continue"'],
    },
  });

  const invokeCalls: string[] = [];
  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'click') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` } };
    }
    const selector = request.positionals?.[0] ?? '';
    invokeCalls.push(selector);
    if (selector.includes('old_continue')) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'selector no longer exists' } };
    }
    if (selector.includes('auth_continue')) {
      return { ok: true, data: { clicked: true } };
    }
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'unexpected selector' } };
  };

  let snapshotDispatchCalls = 0;
  const dispatch = async (
    _device: DeviceInfo,
    command: string,
    _positionals: string[],
    _out?: string,
    _context?: CommandFlags,
  ): Promise<Record<string, unknown> | void> => {
    if (command !== 'snapshot') {
      throw new Error(`unexpected dispatch command: ${command}`);
    }
    snapshotDispatchCalls += 1;
    return {
      nodes: [
        {
          index: 0,
          type: 'XCUIElementTypeButton',
          label: 'Continue',
          identifier: 'auth_continue',
          rect: { x: 10, y: 10, width: 100, height: 44 },
          enabled: true,
          hittable: true,
        },
      ],
      truncated: false,
      backend: 'xctest',
    };
  };

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'replay',
      positionals: [replayPath],
      flags: { replayUpdate: true },
    },
    sessionName,
    logPath: path.join(tempRoot, 'daemon.log'),
    sessionStore,
    invoke,
    dispatch,
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.healed, 1);
    assert.equal(response.data?.replayed, 1);
  }
  assert.equal(snapshotDispatchCalls, 1);
  assert.equal(invokeCalls.length, 2);
  assert.ok(invokeCalls[0].includes('old_continue'));
  assert.ok(invokeCalls[1].includes('auth_continue'));
  const rewrittenSelector = readReplaySelector(replayPath, 'click');
  assert.ok(rewrittenSelector.includes('auth_continue'));
  assert.ok(!rewrittenSelector.includes('old_continue'));
});

test('replay without --update does not heal or rewrite', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-noheal-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.json');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'noheal-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'click',
    positionals: ['id="old_continue"'],
    flags: {},
    result: {
      refLabel: 'Continue',
      selectorChain: ['id="old_continue"', 'label="Continue"'],
    },
  });
  const originalPayload = fs.readFileSync(replayPath, 'utf8');

  const invoke = async (_request: DaemonRequest): Promise<DaemonResponse> => {
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'selector no longer exists' } };
  };

  let snapshotDispatchCalls = 0;
  const dispatch = async (
    _device: DeviceInfo,
    _command: string,
    _positionals: string[],
    _out?: string,
    _context?: CommandFlags,
  ): Promise<Record<string, unknown> | void> => {
    snapshotDispatchCalls += 1;
    return {};
  };

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'replay',
      positionals: [replayPath],
      flags: {},
    },
    sessionName,
    logPath: path.join(tempRoot, 'daemon.log'),
    sessionStore,
    invoke,
    dispatch,
  });

  assert.ok(response);
  assert.equal(response.ok, false);
  assert.equal(snapshotDispatchCalls, 0);
  assert.equal(fs.readFileSync(replayPath, 'utf8'), originalPayload);
});

test('replay --update heals selector in is command', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-is-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.json');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-is-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'is',
    positionals: ['visible', 'id="old_continue"'],
    flags: {},
    result: {
      selectorChain: ['id="old_continue"', 'label="Continue"'],
      refLabel: 'Continue',
    },
  });

  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'is') {
      return { ok: false, error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` } };
    }
    const selector = request.positionals?.[1] ?? '';
    if (selector.includes('old_continue')) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'selector stale' } };
    }
    if (selector.includes('auth_continue')) {
      return { ok: true, data: { predicate: 'visible', pass: true } };
    }
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'unexpected selector' } };
  };

  const dispatch = async (): Promise<Record<string, unknown> | void> => {
    return {
      nodes: [
        {
          index: 0,
          type: 'XCUIElementTypeButton',
          label: 'Continue',
          identifier: 'auth_continue',
          rect: { x: 10, y: 10, width: 100, height: 44 },
          enabled: true,
          hittable: true,
        },
      ],
      truncated: false,
      backend: 'xctest',
    };
  };

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'replay',
      positionals: [replayPath],
      flags: { replayUpdate: true },
    },
    sessionName,
    logPath: path.join(tempRoot, 'daemon.log'),
    sessionStore,
    invoke,
    dispatch,
  });

  assert.ok(response);
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.equal(response.data?.healed, 1);
  }
  const rewrittenSelector = readReplaySelector(replayPath, 'is');
  assert.ok(rewrittenSelector.includes('auth_continue'));
});
