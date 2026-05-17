import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { beforeEach, test, vi } from 'vitest';
import { IOS_SIMULATOR } from '../../../__tests__/test-utils/index.ts';
import { AppError } from '../../../utils/errors.ts';
import type { RunnerSession } from '../runner-session-types.ts';

const {
  mockAcquireXcodebuildSimulatorSetRedirect,
  mockCleanupTempFile,
  mockEnsureXctestrun,
  mockGetFreePort,
  mockIsProcessAlive,
  mockIsProcessGroupAlive,
  mockPrepareXctestrunWithEnv,
  mockRunAppleToolCommand,
  mockRunCmdBackground,
  mockRunXcrun,
  mockSendRunnerCommandOnce,
  mockWaitForRunner,
  mockRedirectRelease,
} = vi.hoisted(() => ({
  mockAcquireXcodebuildSimulatorSetRedirect: vi.fn(),
  mockCleanupTempFile: vi.fn(),
  mockEnsureXctestrun: vi.fn(),
  mockGetFreePort: vi.fn(),
  mockIsProcessAlive: vi.fn(),
  mockIsProcessGroupAlive: vi.fn(),
  mockPrepareXctestrunWithEnv: vi.fn(),
  mockRunAppleToolCommand: vi.fn(),
  mockRunCmdBackground: vi.fn(),
  mockRunXcrun: vi.fn(),
  mockSendRunnerCommandOnce: vi.fn(),
  mockWaitForRunner: vi.fn(),
  mockRedirectRelease: vi.fn(),
}));

vi.mock('../../../utils/exec.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../../../utils/exec.ts')>('../../../utils/exec.ts');
  return {
    ...actual,
    runCmdBackground: mockRunCmdBackground,
  };
});

vi.mock('../../../utils/process-identity.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/process-identity.ts')>(
    '../../../utils/process-identity.ts',
  );
  return {
    ...actual,
    isProcessAlive: mockIsProcessAlive,
    isProcessGroupAlive: mockIsProcessGroupAlive,
  };
});

vi.mock('../tool-provider.ts', async () => {
  const actual = await vi.importActual<typeof import('../tool-provider.ts')>('../tool-provider.ts');
  return {
    ...actual,
    runAppleToolCommand: mockRunAppleToolCommand,
    runXcrun: mockRunXcrun,
  };
});

vi.mock('../runner-transport.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../runner-transport.ts')>('../runner-transport.ts');
  return {
    ...actual,
    cleanupTempFile: mockCleanupTempFile,
    getFreePort: mockGetFreePort,
    sendRunnerCommandOnce: mockSendRunnerCommandOnce,
    waitForRunner: mockWaitForRunner,
  };
});

vi.mock('../runner-xctestrun.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../runner-xctestrun.ts')>('../runner-xctestrun.ts');
  return {
    ...actual,
    acquireXcodebuildSimulatorSetRedirect: mockAcquireXcodebuildSimulatorSetRedirect,
    ensureXctestrun: mockEnsureXctestrun,
    prepareXctestrunWithEnv: mockPrepareXctestrunWithEnv,
  };
});

import {
  ensureRunnerSession,
  executeRunnerCommandWithSession,
  getRunnerSessionSnapshot,
  stopRunnerSession,
  validateRunnerDevice,
} from '../runner-session.ts';

beforeEach(() => {
  vi.resetAllMocks();
  mockRunXcrun.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  mockEnsureXctestrun.mockResolvedValue('/tmp/base-runner.xctestrun');
  mockGetFreePort.mockResolvedValue(8123);
  mockPrepareXctestrunWithEnv.mockResolvedValue({
    xctestrunPath: '/tmp/session-runner.xctestrun',
    jsonPath: '/tmp/session-runner.json',
  });
  mockAcquireXcodebuildSimulatorSetRedirect.mockResolvedValue({ release: mockRedirectRelease });
  mockRunCmdBackground.mockReturnValue(makeBackgroundRunner(4242));
  mockRunAppleToolCommand.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  mockIsProcessAlive.mockReturnValue(true);
  mockIsProcessGroupAlive.mockReturnValue(false);
  mockWaitForRunner.mockResolvedValue(runnerResponse({ uptimeMs: 1 }));
});

test('runner session executes read-only commands without uptime preflight', async () => {
  const session = makeRunnerSession({ ready: false });
  mockWaitForRunner.mockResolvedValueOnce(runnerResponse({ nodes: [], truncated: false }));

  const result = await executeRunnerCommandWithSession(
    IOS_SIMULATOR,
    session,
    { command: 'snapshot', appBundleId: 'com.example.demo' },
    '/tmp/runner.log',
    30_000,
  );

  assert.deepEqual(result, { nodes: [], truncated: false });
  assert.equal(session.ready, true);
  assert.equal(mockWaitForRunner.mock.calls.length, 1);
  assert.deepEqual(mockWaitForRunner.mock.calls[0]?.[2], {
    command: 'snapshot',
    appBundleId: 'com.example.demo',
  });
  assert.equal(mockSendRunnerCommandOnce.mock.calls.length, 0);
});

test('runner session probes readiness before mutating commands', async () => {
  const session = makeRunnerSession({ ready: false });
  mockWaitForRunner.mockResolvedValueOnce(runnerResponse({ uptimeMs: 42 }));
  mockSendRunnerCommandOnce.mockResolvedValueOnce(runnerResponse({ tapped: true }));

  const result = await executeRunnerCommandWithSession(
    IOS_SIMULATOR,
    session,
    { command: 'tap', x: 120, y: 240, appBundleId: 'com.example.demo' },
    '/tmp/runner.log',
    30_000,
  );

  assert.deepEqual(result, { tapped: true });
  assert.equal(session.ready, true);
  assert.equal(mockWaitForRunner.mock.calls.length, 1);
  assert.deepEqual(mockWaitForRunner.mock.calls[0]?.[2], { command: 'uptime' });
  assert.equal(mockSendRunnerCommandOnce.mock.calls.length, 1);
  assert.deepEqual(mockSendRunnerCommandOnce.mock.calls[0]?.[2], {
    command: 'tap',
    x: 120,
    y: 240,
    appBundleId: 'com.example.demo',
  });
});

test('runner session preserves structured runner failures', async () => {
  const session = makeRunnerSession({ ready: true });
  mockWaitForRunner.mockResolvedValueOnce(
    runnerError({
      code: 'COMMAND_FAILED',
      message: 'Runner crashed while reading snapshot',
    }),
  );

  await assert.rejects(
    () =>
      executeRunnerCommandWithSession(
        IOS_SIMULATOR,
        session,
        { command: 'snapshot', appBundleId: 'com.example.demo' },
        '/tmp/runner.log',
        30_000,
      ),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'COMMAND_FAILED');
      assert.equal(error.message, 'Runner crashed while reading snapshot');
      assert.equal(error.details?.logPath, '/tmp/runner.log');
      return true;
    },
  );
});

test('runner session starts xcodebuild through provider seams and reuses an alive session', async () => {
  const device = { ...IOS_SIMULATOR, id: 'runner-session-start-sim' };

  const session = await ensureRunnerSession(device, {
    verbose: true,
    logPath: '/tmp/runner.log',
    traceLogPath: '/tmp/runner.trace',
  });
  const reused = await ensureRunnerSession(device, {});

  assert.equal(reused, session);
  assert.equal(session.port, 8123);
  assert.equal(session.xctestrunPath, '/tmp/session-runner.xctestrun');
  assert.equal(mockRunCmdBackground.mock.calls.length, 1);
  assert.equal(mockRunCmdBackground.mock.calls[0]?.[0], 'xcodebuild');
  assert.deepEqual(mockPrepareXctestrunWithEnv.mock.calls[0]?.[1], {
    AGENT_DEVICE_RUNNER_PORT: '8123',
  });
  assert.equal(mockRunXcrun.mock.calls[0]?.[0]?.includes('bootstatus'), true);
  assert.ok(mockRunXcrun.mock.calls.some((call) => call[0]?.includes('uninstall')));
  assert.deepEqual(getRunnerSessionSnapshot(device.id), {
    sessionId: session.sessionId,
    alive: true,
  });

  mockIsProcessAlive.mockReturnValue(false);
  await stopRunnerSession(session);
});

test('runner session stop sends shutdown, cleans temporary runner files, and releases simulator scope', async () => {
  const device = { ...IOS_SIMULATOR, id: 'runner-session-stop-sim' };
  const session = await ensureRunnerSession(device, {});

  mockIsProcessAlive.mockReturnValue(false);
  await stopRunnerSession(session);

  assert.deepEqual(mockWaitForRunner.mock.calls.at(-1)?.[2], { command: 'shutdown' });
  assert.deepEqual(mockCleanupTempFile.mock.calls, [
    ['/tmp/session-runner.xctestrun'],
    ['/tmp/session-runner.json'],
  ]);
  assert.equal(mockRedirectRelease.mock.calls.length, 1);
  assert.equal(getRunnerSessionSnapshot(device.id), null);
});

test('runner session validates supported Apple runner devices', () => {
  validateRunnerDevice({ ...IOS_SIMULATOR, platform: 'ios', kind: 'simulator' });
  validateRunnerDevice({
    ...IOS_SIMULATOR,
    id: 'runner-session-macos',
    platform: 'macos',
    kind: 'device',
    target: 'desktop',
  });
  assert.throws(
    () => validateRunnerDevice({ ...IOS_SIMULATOR, platform: 'android' }),
    /Unsupported platform/,
  );
  assert.throws(
    () => validateRunnerDevice({ ...IOS_SIMULATOR, kind: 'emulator' }),
    /Unsupported iOS device kind/,
  );
});

function makeRunnerSession(overrides: Partial<RunnerSession> = {}): RunnerSession {
  return {
    sessionId: `session-${overrides.port ?? 8100}`,
    device: IOS_SIMULATOR,
    deviceId: IOS_SIMULATOR.id,
    port: 8100,
    xctestrunPath: '/tmp/runner.xctestrun',
    jsonPath: '/tmp/runner.json',
    testPromise: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
    child: { pid: 1234, exitCode: null },
    ready: true,
    ...overrides,
  } as RunnerSession;
}

function makeBackgroundRunner(pid: number) {
  return {
    child: {
      pid,
      exitCode: null,
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
    },
    wait: Promise.resolve({ exitCode: 0, stdout: '', stderr: '' }),
  };
}

function runnerResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, data }));
}

function runnerError(error: { code: string; message: string }): Response {
  return new Response(JSON.stringify({ ok: false, error }));
}
