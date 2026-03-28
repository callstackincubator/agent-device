import { test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})), resolveTargetDevice: vi.fn() };
});
vi.mock('../../device-ready.ts', () => ({ ensureDeviceReady: vi.fn(async () => {}) }));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandFlags } from '../../../core/dispatch.ts';
import { handleSessionCommands } from '../session.ts';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionAction, SessionState } from '../../types.ts';
import type { DeviceInfo } from '../../../utils/device.ts';
import { dispatchCommand, resolveTargetDevice } from '../../../core/dispatch.ts';
import { ensureDeviceReady } from '../../device-ready.ts';

const mockDispatchCommand = vi.mocked(dispatchCommand);
const mockResolveTargetDevice = vi.mocked(resolveTargetDevice);
const mockEnsureDeviceReady = vi.mocked(ensureDeviceReady);

beforeEach(() => {
  mockDispatchCommand.mockReset();
  mockDispatchCommand.mockResolvedValue({});
  mockResolveTargetDevice.mockReset();
  mockEnsureDeviceReady.mockReset();
  mockEnsureDeviceReady.mockResolvedValue(undefined);
});

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
  const args = action.positionals.map((value) => JSON.stringify(value)).join(' ');
  fs.writeFileSync(filePath, `${action.command}${args.length > 0 ? ` ${args}` : ''}\n`);
}

function readReplaySelector(filePath: string, command: string): string {
  const lines = fs
    .readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const line = lines.find((entry) => entry.startsWith(`${command} `) || entry === command);
  if (!line) return '';
  const args = tokenizeReplayLine(line).slice(1);
  if (command === 'is') {
    return args[1] ?? '';
  }
  return args[0] ?? '';
}

function tokenizeReplayLine(line: string): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor])) {
      cursor += 1;
    }
    if (cursor >= line.length) break;
    if (line[cursor] === '"') {
      let end = cursor + 1;
      let escaped = false;
      while (end < line.length) {
        const char = line[end];
        if (char === '"' && !escaped) break;
        escaped = char === '\\' && !escaped;
        if (char !== '\\') escaped = false;
        end += 1;
      }
      if (end >= line.length) {
        throw new Error(`Invalid replay script line: ${line}`);
      }
      tokens.push(JSON.parse(line.slice(cursor, end + 1)) as string);
      cursor = end + 1;
      continue;
    }
    let end = cursor;
    while (end < line.length && !/\s/.test(line[end])) {
      end += 1;
    }
    tokens.push(line.slice(cursor, end));
    cursor = end;
  }
  return tokens;
}

test('replay --update heals selector and rewrites replay file', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'click',
    positionals: ['id="old_continue" || label="Continue"'],
    flags: {},
    result: {},
  });

  const invokeCalls: string[] = [];
  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'click') {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` },
      };
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
  mockDispatchCommand.mockImplementation(
    async (
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
    },
  );

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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(true);
  if (response!.ok) {
    expect(response!.data?.healed).toBe(1);
    expect(response!.data?.replayed).toBe(1);
  }
  expect(snapshotDispatchCalls).toBe(1);
  expect(invokeCalls.length).toBe(2);
  expect(invokeCalls[0]).toContain('old_continue');
  expect(invokeCalls[1]).toContain('auth_continue');
  const rewrittenSelector = readReplaySelector(replayPath, 'click');
  expect(rewrittenSelector).toContain('auth_continue');
  expect(rewrittenSelector).not.toContain('old_continue');
});

test('replay tolerates legacy snapshot --backend and strips it on rewrite', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-legacy-backend-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'legacy-backend-session';
  sessionStore.set(sessionName, makeSession(sessionName));
  fs.writeFileSync(
    replayPath,
    [
      'snapshot -i --backend xctest',
      'click "id=\\"old_continue\\" || label=\\"Continue\\""',
      '',
    ].join('\n'),
  );

  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command === 'snapshot') {
      return { ok: true, data: { nodes: [] } };
    }
    if (request.command === 'click') {
      const selector = request.positionals?.[0] ?? '';
      if (selector.includes('old_continue')) {
        return {
          ok: false,
          error: { code: 'COMMAND_FAILED', message: 'selector no longer exists' },
        };
      }
      if (selector.includes('auth_continue')) {
        return { ok: true, data: { clicked: true } };
      }
    }
    return {
      ok: false,
      error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` },
    };
  };

  mockDispatchCommand.mockResolvedValue({
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
  });

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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(true);
  const rewritten = fs.readFileSync(replayPath, 'utf8');
  expect(rewritten).toMatch(/^snapshot -i$/m);
  expect(rewritten).not.toMatch(/--backend/);
});

test('replay without --update does not heal or rewrite', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-noheal-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'noheal-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'click',
    positionals: ['id="old_continue" || label="Continue"'],
    flags: {},
    result: {},
  });
  const originalPayload = fs.readFileSync(replayPath, 'utf8');

  const invoke = async (_request: DaemonRequest): Promise<DaemonResponse> => {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'selector no longer exists',
        hint: 'update selector',
        diagnosticId: 'diag-replay-1',
        logPath: '/tmp/diag-replay-1.ndjson',
      },
    };
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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(false);
  if (!response!.ok) {
    expect(response!.error.message).toMatch(/Replay failed at step 1/);
    expect(response!.error.details?.step).toBe(1);
    expect(response!.error.details?.action).toBe('click');
    expect(response!.error.hint).toBe('update selector');
    expect(response!.error.diagnosticId).toBe('diag-replay-1');
    expect(response!.error.logPath).toBe('/tmp/diag-replay-1.ndjson');
  }
  expect(mockDispatchCommand).not.toHaveBeenCalled();
  expect(fs.readFileSync(replayPath, 'utf8')).toBe(originalPayload);
});

test('replay --update skips malformed selector candidates and preserves replay error context', async () => {
  const tempRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), 'agent-device-replay-malformed-candidate-'),
  );
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'malformed-candidate-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'click',
    positionals: ['id="old_continue" ||'],
    flags: {},
    result: {},
  });

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
    invoke: async () => ({
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'selector stale' },
    }),
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(false);
  if (!response!.ok) {
    expect(response!.error.code).toBe('COMMAND_FAILED');
    expect(response!.error.message).toMatch(/Replay failed at step 1/);
    expect(response!.error.details?.step).toBe(1);
    expect(response!.error.details?.action).toBe('click');
  }
  expect(mockDispatchCommand).not.toHaveBeenCalled();
  expect(fs.readFileSync(replayPath, 'utf8')).toBe('click "id=\\"old_continue\\" ||"\n');
});

test('replay --update heals selector in is command', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-is-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-is-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'is',
    positionals: ['visible', 'id="old_continue" || label="Continue"'],
    flags: {},
    result: {},
  });

  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'is') {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` },
      };
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

  mockDispatchCommand.mockResolvedValue({
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
  });

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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(true);
  if (response!.ok) {
    expect(response!.data?.healed).toBe(1);
  }
  const rewrittenSelector = readReplaySelector(replayPath, 'is');
  expect(rewrittenSelector).toContain('auth_continue');
});

test('replay --update does not heal clicks from stored ref labels alone', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-ref-label-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-ref-label-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  // @refs are never selector candidates; this guards against reintroducing
  // fallback healing from the stored replay label.
  fs.writeFileSync(replayPath, 'click @e1 "Continue"\n');
  const originalPayload = fs.readFileSync(replayPath, 'utf8');

  const invokeCalls: string[] = [];
  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'click') {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` },
      };
    }
    const target = request.positionals?.[0] ?? '';
    invokeCalls.push(target);
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'missing ref target' } };
  };

  mockDispatchCommand.mockResolvedValue({
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
  });

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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(false);
  if (!response!.ok) {
    expect(response!.error.message).toMatch(/Replay failed at step 1/);
    expect(response!.error.details?.step).toBe(1);
    expect(response!.error.details?.action).toBe('click');
  }
  expect(mockDispatchCommand).not.toHaveBeenCalled();
  expect(invokeCalls).toEqual(['@e1']);
  expect(fs.readFileSync(replayPath, 'utf8')).toBe(originalPayload);
});

test('replay --update does not heal numeric get text drift from snapshot text alone', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-get-numeric-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-get-numeric-session';
  sessionStore.set(sessionName, makeSession(sessionName));

  writeReplayFile(replayPath, {
    ts: Date.now(),
    command: 'get',
    positionals: ['text', 'role="statictext" label="2" || label="2"'],
    flags: {},
    result: {},
  });
  const originalPayload = fs.readFileSync(replayPath, 'utf8');

  const invokeCalls: string[] = [];
  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'get') {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` },
      };
    }
    const selector = request.positionals?.[1] ?? '';
    invokeCalls.push(selector);
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'selector stale' } };
  };

  mockDispatchCommand.mockResolvedValue({
    nodes: [
      {
        index: 0,
        type: 'XCUIElementTypeStaticText',
        label: '20',
        rect: { x: 0, y: 100, width: 100, height: 24 },
        enabled: true,
        hittable: true,
      },
      {
        index: 1,
        type: 'XCUIElementTypeStaticText',
        label: 'Version: 0.84.0',
        rect: { x: 0, y: 200, width: 220, height: 17 },
        enabled: true,
        hittable: true,
      },
    ],
    truncated: false,
    backend: 'xctest',
  });

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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(false);
  if (!response!.ok) {
    expect(response!.error.message).toMatch(/Replay failed at step 1/);
    expect(response!.error.details?.step).toBe(1);
    expect(response!.error.details?.action).toBe('get');
  }
  expect(mockDispatchCommand).toHaveBeenCalledTimes(1);
  expect(invokeCalls.length).toBe(1);
  expect(fs.readFileSync(replayPath, 'utf8')).toBe(originalPayload);
});

test('replay --update heals selector in press command and preserves press series flags', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-heal-press-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'heal-press-session';
  sessionStore.set(sessionName, makeSession(sessionName));
  fs.writeFileSync(
    replayPath,
    'press "id=\\"old_continue\\" || label=\\"Continue\\"" --count 3 --interval-ms 1 --double-tap\n',
  );

  const invokeCalls: DaemonRequest[] = [];
  const invoke = async (request: DaemonRequest): Promise<DaemonResponse> => {
    if (request.command !== 'press') {
      return {
        ok: false,
        error: { code: 'INVALID_ARGS', message: `unexpected command ${request.command}` },
      };
    }
    invokeCalls.push(request);
    const selector = request.positionals?.[0] ?? '';
    if (selector.includes('old_continue')) {
      return { ok: false, error: { code: 'COMMAND_FAILED', message: 'selector no longer exists' } };
    }
    if (selector.includes('auth_continue')) {
      return { ok: true, data: { pressed: true } };
    }
    return { ok: false, error: { code: 'COMMAND_FAILED', message: 'unexpected selector' } };
  };

  mockDispatchCommand.mockResolvedValue({
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
  });

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
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(true);
  if (response!.ok) {
    expect(response!.data?.healed).toBe(1);
    expect(response!.data?.replayed).toBe(1);
  }
  expect(invokeCalls.length).toBe(2);
  expect(invokeCalls[0]?.flags?.count).toBe(3);
  expect(invokeCalls[0]?.flags?.intervalMs).toBe(1);
  expect(invokeCalls[0]?.flags?.doubleTap).toBe(true);
  const updatedLine = fs
    .readFileSync(replayPath, 'utf8')
    .split(/\r?\n/)
    .find((line) => line.startsWith('press '));
  expect(updatedLine).toBeTruthy();
  const tokens = tokenizeReplayLine(updatedLine!);
  expect(tokens[1]).toContain('auth_continue');
  expect(tokens.slice(2)).toEqual(['--count', '3', '--interval-ms', '1', '--double-tap']);
});

test('replay rejects legacy JSON payload files', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-json-rejected-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.json');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'json-rejected-session';
  sessionStore.set(sessionName, makeSession(sessionName));
  fs.writeFileSync(replayPath, JSON.stringify({ optimizedActions: [] }, null, 2));

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
    invoke: async () => ({ ok: true, data: {} }),
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(false);
  if (!response!.ok) {
    expect(response!.error.code).toBe('INVALID_ARGS');
    expect(response!.error.message).toMatch(/\.ad script files/);
  }
});

test('replay rejects malformed .ad lines with unclosed quotes', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-replay-invalid-ad-'));
  const sessionsDir = path.join(tempRoot, 'sessions');
  const replayPath = path.join(tempRoot, 'replay.ad');
  const sessionStore = new SessionStore(sessionsDir);
  const sessionName = 'invalid-ad-session';
  sessionStore.set(sessionName, makeSession(sessionName));
  fs.writeFileSync(replayPath, 'click "id=\\"broken\\"\n');

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
    invoke: async () => ({ ok: true, data: {} }),
  });

  expect(response).toBeTruthy();
  expect(response!.ok).toBe(false);
  if (!response!.ok) {
    expect(response!.error.code).toBe('INVALID_ARGS');
    expect(response!.error.message).toMatch(/Invalid replay script line/);
  }
});
