import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { IOS_SIMULATOR } from '../../../__tests__/test-utils/index.ts';
import { AppError } from '../../../utils/errors.ts';
import type { RunnerSession } from '../runner-session-types.ts';

const {
  mockEnsureRunnerSession,
  mockExecuteRunnerCommandWithSession,
  mockInvalidateRunnerSession,
  mockStopRunnerSession,
} = vi.hoisted(() => ({
  mockEnsureRunnerSession: vi.fn(),
  mockExecuteRunnerCommandWithSession: vi.fn(),
  mockInvalidateRunnerSession: vi.fn(),
  mockStopRunnerSession: vi.fn(),
}));

vi.mock('../runner-session.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../runner-session.ts')>('../runner-session.ts');
  return {
    ...actual,
    ensureRunnerSession: mockEnsureRunnerSession,
    executeRunnerCommandWithSession: mockExecuteRunnerCommandWithSession,
    invalidateRunnerSession: mockInvalidateRunnerSession,
    stopRunnerSession: mockStopRunnerSession,
  };
});

import { runIosRunnerCommand } from '../runner-client.ts';

beforeEach(() => {
  vi.resetAllMocks();
});

test('mutating commands restart stale ready sessions when the preflight probe never reaches the runner', async () => {
  const staleSession = makeRunnerSession({ port: 8100, ready: true });
  const freshSession = makeRunnerSession({ port: 8101, ready: false });

  mockEnsureRunnerSession.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner did not accept connection'))
    .mockResolvedValueOnce({ message: 'tapped' });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });

  assert.deepEqual(result, { message: 'tapped' });
  assert.equal(mockEnsureRunnerSession.mock.calls.length, 2);
  assert.equal(mockEnsureRunnerSession.mock.calls[1]?.[1]?.cleanStaleBundles, true);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls[0], [
    staleSession,
    'runner_connect_failed_before_command_send',
  ]);
  assert.equal(mockStopRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[0]?.[2].command, 'tap');
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[1], freshSession);
});

test('mutating commands retry startup sessions with stale bundle cleanup', async () => {
  const startupSession = makeRunnerSession({ port: 8100, ready: false });
  const freshSession = makeRunnerSession({ port: 8101, ready: false });

  mockEnsureRunnerSession.mockResolvedValueOnce(startupSession).mockResolvedValueOnce(freshSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner did not accept connection'))
    .mockResolvedValueOnce({ message: 'tapped' });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });

  assert.deepEqual(result, { message: 'tapped' });
  assert.equal(mockEnsureRunnerSession.mock.calls.length, 2);
  assert.equal(mockEnsureRunnerSession.mock.calls[1]?.[1]?.cleanStaleBundles, true);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls[0], [
    startupSession,
    'runner_connect_failed_before_command_send',
  ]);
  assert.equal(mockStopRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[1], freshSession);
});

test('mutating commands restart stale sessions when readiness preflight fails before command send', async () => {
  const staleSession = makeRunnerSession({ port: 8100, ready: true });
  const freshSession = makeRunnerSession({ port: 8101, ready: false });

  mockEnsureRunnerSession.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(
      new AppError('COMMAND_FAILED', 'fetch failed', {
        runnerReadinessPreflightFailed: true,
      }),
    )
    .mockResolvedValueOnce({ message: 'tapped' });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });

  assert.deepEqual(result, { message: 'tapped' });
  assert.equal(mockEnsureRunnerSession.mock.calls.length, 2);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls[0], [
    staleSession,
    'runner_readiness_preflight_failed_before_command_send',
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[1], freshSession);
});

test('mutating commands restart stale sessions when readiness preflight times out before command send', async () => {
  const staleSession = makeRunnerSession({ port: 8100, ready: true });
  const freshSession = makeRunnerSession({ port: 8101, ready: false });

  mockEnsureRunnerSession.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(
      new AppError('COMMAND_FAILED', 'Runner readiness timed out', {
        runnerReadinessPreflightFailed: true,
      }),
    )
    .mockResolvedValueOnce({ message: 'tapped' });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });

  assert.deepEqual(result, { message: 'tapped' });
  assert.equal(mockEnsureRunnerSession.mock.calls.length, 2);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls[0], [
    staleSession,
    'runner_readiness_preflight_failed_before_command_send',
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[1], freshSession);
});

test('mutating commands do not restart or replay after command send failure', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession.mockRejectedValueOnce(
    new AppError('COMMAND_FAILED', 'fetch failed'),
  );

  await assert.rejects(() =>
    runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
  );

  assert.equal(mockEnsureRunnerSession.mock.calls.length, 1);
  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 1);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls[0], [
    session,
    'transport_error_after_command_send',
  ]);
  assert.equal(mockStopRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 1);
});

test('mutating commands invalidate the retry session without replaying again', async () => {
  const staleSession = makeRunnerSession({ port: 8100, ready: true });
  const freshSession = makeRunnerSession({ port: 8101, ready: false });

  mockEnsureRunnerSession.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner did not accept connection'))
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'));

  await assert.rejects(() =>
    runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
  );

  assert.equal(mockEnsureRunnerSession.mock.calls.length, 2);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls, [
    [staleSession, 'runner_connect_failed_before_command_send'],
    [freshSession, 'transport_error_after_retry_command_send'],
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
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
