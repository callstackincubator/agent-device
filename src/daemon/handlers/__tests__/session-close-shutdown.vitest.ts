import { test, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../../session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from '../../types.ts';
import { AppError } from '../../../utils/errors.ts';

vi.mock('../../../platforms/ios/simulator.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/ios/simulator.ts')>();
  return { ...actual, shutdownSimulator: vi.fn() };
});
vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn() };
});
vi.mock('../../../platforms/ios/runner-client.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/ios/runner-client.ts')>();
  return { ...actual, stopIosRunnerSession: vi.fn(async () => {}) };
});
vi.mock('../../../platforms/ios/macos-helper.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../platforms/ios/macos-helper.ts')>();
  return { ...actual, runMacOsAlertAction: vi.fn(async () => {}) };
});
vi.mock('../../runtime-hints.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../runtime-hints.ts')>();
  return { ...actual, clearRuntimeHintsFromApp: vi.fn(async () => {}) };
});
vi.mock('../../../core/dispatch.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../core/dispatch.ts')>();
  return { ...actual, dispatchCommand: vi.fn(async () => ({})) };
});
vi.mock('../session-device-utils.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../session-device-utils.ts')>();
  return { ...actual, settleIosSimulator: vi.fn(async () => {}) };
});

import { handleSessionCommands } from '../session.ts';
import { shutdownSimulator } from '../../../platforms/ios/simulator.ts';
import { runCmd } from '../../../utils/exec.ts';

const mockShutdownSimulator = vi.mocked(shutdownSimulator);
const mockRunCmd = vi.mocked(runCmd);

const noopInvoke = async (_req: DaemonRequest): Promise<DaemonResponse> => ({ ok: true, data: {} });

function makeSessionStore(): SessionStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-session-close-shutdown-'));
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

beforeEach(() => {
  vi.clearAllMocks();
});

test('close --shutdown calls shutdownSimulator for iOS simulator and includes result in response', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-udid-1',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
  );

  const shutdownCalls: string[] = [];
  mockShutdownSimulator.mockImplementation(async (device) => {
    shutdownCalls.push(device.id);
    return { success: true, exitCode: 0, stdout: '', stderr: '' };
  });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(shutdownCalls).toEqual(['sim-udid-1']);
  expect(sessionStore.get(sessionName)).toBeUndefined();
  if (response && response.ok) {
    expect(response.data?.session).toBe(sessionName);
    expect(response.data?.shutdown).toEqual({
      success: true,
      exitCode: 0,
      stdout: '',
      stderr: '',
    });
  }
});

test('close --shutdown calls shutdownAndroidEmulator for Android emulator and includes result in response', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5554',
      name: 'Pixel_9_API_35',
      kind: 'emulator',
      booted: true,
    }),
  );

  mockRunCmd.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockRunCmd).toHaveBeenCalledWith(
    'adb',
    ['-s', 'emulator-5554', 'emu', 'kill'],
    expect.objectContaining({ allowFailure: true }),
  );
  expect(sessionStore.get(sessionName)).toBeUndefined();
  if (response && response.ok) {
    expect(response.data?.session).toBe(sessionName);
    expect(response.data?.shutdown).toEqual({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    });
  }
});

test('close --shutdown is ignored for non-simulator iOS devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-device-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'physical-device-1',
      name: 'My iPhone',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockShutdownSimulator).not.toHaveBeenCalled();
  expect(sessionStore.get(sessionName)).toBeUndefined();
  if (response && response.ok) {
    expect(response.data?.session).toBe(sessionName);
    expect(response.data?.shutdown).toBeUndefined();
  }
});

test('close --shutdown is ignored for Android devices', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-device-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'R5CT123456A',
      name: 'Pixel 9',
      kind: 'device',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockRunCmd).not.toHaveBeenCalled();
  expect(sessionStore.get(sessionName)).toBeUndefined();
  if (response && response.ok) {
    expect(response.data?.session).toBe(sessionName);
    expect(response.data?.shutdown).toBeUndefined();
  }
});

test('close without --shutdown does not call shutdownSimulator', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-no-shutdown-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-udid-2',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: {},
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(mockShutdownSimulator).not.toHaveBeenCalled();
  if (response && response.ok) {
    expect(response.data?.shutdown).toBeUndefined();
  }
});

test('close --shutdown returns success and failure payload when shutdownAndroidEmulator throws', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'android-shutdown-failure-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'android',
      id: 'emulator-5556',
      name: 'Pixel_9_API_35',
      kind: 'emulator',
      booted: true,
    }),
  );

  mockRunCmd.mockRejectedValue(new AppError('COMMAND_FAILED', 'adb emu kill failed'));

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(sessionStore.get(sessionName)).toBeUndefined();
  if (response && response.ok) {
    const shutdown = response.data?.shutdown as
      | {
          success?: boolean;
          exitCode?: number;
          stdout?: string;
          stderr?: string;
          error?: {
            code?: string;
            message?: string;
          };
        }
      | undefined;
    expect(response.data?.session).toBe(sessionName);
    expect(shutdown?.success).toBe(false);
    expect(shutdown?.exitCode).toBe(-1);
    expect(shutdown?.stdout).toBe('');
    expect(shutdown?.stderr).toBe('adb emu kill failed');
    expect(shutdown?.error?.code).toBe('COMMAND_FAILED');
    expect(shutdown?.error?.message).toBe('adb emu kill failed');
  }
});

test('close --shutdown returns success and failure payload when shutdownSimulator throws', async () => {
  const sessionStore = makeSessionStore();
  const sessionName = 'ios-shutdown-failure-session';
  sessionStore.set(
    sessionName,
    makeSession(sessionName, {
      platform: 'ios',
      id: 'sim-udid-3',
      name: 'iPhone 15',
      kind: 'simulator',
      booted: true,
    }),
  );

  mockShutdownSimulator.mockRejectedValue(
    new AppError('COMMAND_FAILED', 'simctl shutdown failed'),
  );

  const response = await handleSessionCommands({
    req: {
      token: 't',
      session: sessionName,
      command: 'close',
      positionals: [],
      flags: { shutdown: true },
    },
    sessionName,
    logPath: path.join(os.tmpdir(), 'daemon.log'),
    sessionStore,
    invoke: noopInvoke,
  });

  expect(response).toBeTruthy();
  expect(response?.ok).toBe(true);
  expect(sessionStore.get(sessionName)).toBeUndefined();
  if (response && response.ok) {
    const shutdown = response.data?.shutdown as
      | {
          success?: boolean;
          exitCode?: number;
          stdout?: string;
          stderr?: string;
          error?: {
            code?: string;
            message?: string;
          };
        }
      | undefined;
    expect(response.data?.session).toBe(sessionName);
    expect(shutdown?.success).toBe(false);
    expect(shutdown?.exitCode).toBe(-1);
    expect(shutdown?.stdout).toBe('');
    expect(shutdown?.stderr).toBe('simctl shutdown failed');
    expect(shutdown?.error?.code).toBe('COMMAND_FAILED');
    expect(shutdown?.error?.message).toBe('simctl shutdown failed');
  }
});
