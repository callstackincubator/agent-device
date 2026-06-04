import { beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { IOS_SIMULATOR } from '../../../__tests__/test-utils/index.ts';
import { AppError } from '../../../utils/errors.ts';
import type { RunnerSession } from '../runner-session-types.ts';

const {
  mockEnsureRunnerSession,
  mockExecuteRunnerCommandWithSession,
  mockEmitDiagnostic,
  mockInvalidateRunnerSession,
  mockMarkRunnerXctestrunArtifactBadForRun,
  mockStopRunnerSession,
} = vi.hoisted(() => ({
  mockEnsureRunnerSession: vi.fn(),
  mockExecuteRunnerCommandWithSession: vi.fn(),
  mockEmitDiagnostic: vi.fn(),
  mockInvalidateRunnerSession: vi.fn(),
  mockMarkRunnerXctestrunArtifactBadForRun: vi.fn(),
  mockStopRunnerSession: vi.fn(),
}));

vi.mock('../../../utils/diagnostics.ts', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/diagnostics.ts')>(
    '../../../utils/diagnostics.ts',
  );
  return {
    ...actual,
    emitDiagnostic: mockEmitDiagnostic,
  };
});

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

vi.mock('../runner-xctestrun.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../runner-xctestrun.ts')>('../runner-xctestrun.ts');
  return {
    ...actual,
    markRunnerXctestrunArtifactBadForRun: mockMarkRunnerXctestrunArtifactBadForRun,
  };
});

import { prepareIosRunner, runIosRunnerCommand } from '../runner-client.ts';
import type { RunnerXctestrunArtifact } from '../runner-xctestrun.ts';

beforeEach(() => {
  vi.resetAllMocks();
  mockMarkRunnerXctestrunArtifactBadForRun.mockResolvedValue(undefined);
});

test('prepareIosRunner marks a bad restored artifact and rebuilds once after health failure', async () => {
  const restoredArtifact = makeRunnerArtifact({
    xctestrunPath: '/tmp/restored.xctestrun',
    cache: 'exact',
    artifact: 'valid',
  });
  const rebuiltArtifact = makeRunnerArtifact({
    xctestrunPath: '/tmp/rebuilt.xctestrun',
    cache: 'miss',
    artifact: 'rebuilt',
    buildMs: 123,
  });
  const restoredSession = makeRunnerSession({
    port: 8100,
    xctestrunPath: restoredArtifact.xctestrunPath,
    xctestrunArtifact: restoredArtifact,
  });
  const rebuiltSession = makeRunnerSession({
    port: 8101,
    xctestrunPath: rebuiltArtifact.xctestrunPath,
    xctestrunArtifact: rebuiltArtifact,
  });

  mockEnsureRunnerSession
    .mockResolvedValueOnce(restoredSession)
    .mockResolvedValueOnce(rebuiltSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner did not accept connection'))
    .mockResolvedValueOnce({ uptimeMs: 42 });

  const result = await prepareIosRunner(IOS_SIMULATOR, {
    healthTimeoutMs: 90_000,
    buildTimeoutMs: 300_000,
  });

  assert.deepEqual(result, {
    runner: { uptimeMs: 42 },
    cache: 'miss',
    artifact: 'rebuilt',
    buildMs: 123,
    connectMs: result.connectMs,
    healthCheckMs: result.healthCheckMs,
    xctestrunPath: '/tmp/rebuilt.xctestrun',
    failureReason: 'Runner did not accept connection',
  });
  assert.equal(result.connectMs >= 0, true);
  assert.equal(result.healthCheckMs >= 0, true);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls[0], [
    restoredSession,
    'prepare_cached_runner_health_failed',
  ]);
  assert.deepEqual(mockMarkRunnerXctestrunArtifactBadForRun.mock.calls[0], [
    restoredArtifact,
    'Runner did not accept connection',
  ]);
  assert.deepEqual(mockEnsureRunnerSession.mock.calls[1]?.[1], {
    healthTimeoutMs: 90_000,
    buildTimeoutMs: 300_000,
    cleanStaleBundles: true,
    forceRunnerXctestrunRebuild: true,
  });
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[0]?.[2].command, 'uptime');
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[0]?.[4], 90_000);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[1], rebuiltSession);
  assert.ok(
    mockEmitDiagnostic.mock.calls.some(
      ([event]) => event.phase === 'ios_runner_prepare_bad_cache_recovered',
    ),
  );
});

test('prepareIosRunner invalidates rebuilt sessions when bad-cache recovery health fails', async () => {
  const restoredArtifact = makeRunnerArtifact({
    xctestrunPath: '/tmp/restored.xctestrun',
    cache: 'restore-key',
    artifact: 'valid',
  });
  const rebuiltArtifact = makeRunnerArtifact({
    xctestrunPath: '/tmp/rebuilt.xctestrun',
    cache: 'miss',
    artifact: 'rebuilt',
  });
  const restoredSession = makeRunnerSession({
    port: 8100,
    xctestrunPath: restoredArtifact.xctestrunPath,
    xctestrunArtifact: restoredArtifact,
  });
  const rebuiltSession = makeRunnerSession({
    port: 8101,
    xctestrunPath: rebuiltArtifact.xctestrunPath,
    xctestrunArtifact: rebuiltArtifact,
  });

  mockEnsureRunnerSession
    .mockResolvedValueOnce(restoredSession)
    .mockResolvedValueOnce(rebuiltSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner endpoint probe failed'))
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner health timed out'));

  await assert.rejects(
    () => prepareIosRunner(IOS_SIMULATOR, { healthTimeoutMs: 90_000 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.message, 'artifact restored but runner did not connect');
      assert.equal(error.details?.restoredFailureReason, 'Runner endpoint probe failed');
      assert.equal(error.details?.xctestrunPath, '/tmp/rebuilt.xctestrun');
      assert.equal(error.details?.artifact, 'rebuilt');
      assert.equal(error.details?.cache, 'miss');
      return true;
    },
  );

  assert.deepEqual(mockInvalidateRunnerSession.mock.calls, [
    [restoredSession, 'prepare_cached_runner_health_failed'],
    [rebuiltSession, 'prepare_rebuilt_runner_health_failed'],
  ]);
  assert.deepEqual(mockMarkRunnerXctestrunArtifactBadForRun.mock.calls[0], [
    restoredArtifact,
    'Runner endpoint probe failed',
  ]);
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

test('mutating commands emit readiness recovery diagnostics after failed preflight restart succeeds', async () => {
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

  const diagnostics = await captureDiagnostics(async () => {
    const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });
    assert.deepEqual(result, { message: 'tapped' });
  });

  assert.match(diagnostics, /ios_runner_readiness_preflight_recovered/);
  assert.match(diagnostics, /"recovery":"session_restarted"/);
});

test('mutating commands do not restart or replay after command send failure', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({ lifecycleState: 'notAccepted' });

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
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'retained',
    reason: 'unknown_lifecycle_state',
    lifecycleState: 'notAccepted',
  });
});

test('mutating commands recover cached responses before invalidating after command send failure', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({
      lifecycleState: 'completed',
      lifecycleResponseJson: JSON.stringify({ ok: true, data: { message: 'tapped' } }),
    });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });

  assert.deepEqual(result, { message: 'tapped' });
  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assertDiagnosticDecision({
    decision: 'skipped',
    reason: 'completed_with_retained_response',
    lifecycleState: 'completed',
  });
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  const sentCommand = mockExecuteRunnerCommandWithSession.mock.calls[0]?.[2];
  const statusCommand = mockExecuteRunnerCommandWithSession.mock.calls[1]?.[2];
  assert.equal(statusCommand.command, 'status');
  assert.equal(statusCommand.statusCommandId, sentCommand.commandId);
});

test('mutating commands run status recovery after transport failure when readiness preflight was skipped', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(
      new AppError('COMMAND_FAILED', 'fetch failed', {
        runnerReadinessPreflightSkipped: true,
        runnerReadinessPreflightSkipReason: 'recent_successful_response',
      }),
    )
    .mockResolvedValueOnce({
      lifecycleState: 'completed',
      lifecycleResponseJson: JSON.stringify({ ok: true, data: { message: 'tapped' } }),
    });

  const diagnostics = await captureDiagnostics(async () => {
    const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 });
    assert.deepEqual(result, { message: 'tapped' });
  });

  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[2].command, 'status');
  assert.match(diagnostics, /ios_runner_command_status_recovery/);
  assert.match(diagnostics, /"readinessPreflightSkipped":true/);
  assert.match(diagnostics, /"readinessPreflightSkipReason":"recent_successful_response"/);
});

test('mutating commands keep invalidating when status cannot find the command', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({
      lifecycleState: 'notAccepted',
    });

  await assert.rejects(() =>
    runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
  );

  assert.deepEqual(mockInvalidateRunnerSession.mock.calls, [
    [session, 'transport_error_after_command_send'],
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'retained',
    reason: 'unknown_lifecycle_state',
    lifecycleState: 'notAccepted',
  });
});

test('mutating commands keep invalidating when status recovery probe fails', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'status probe failed'));

  await assert.rejects(() =>
    runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
  );

  assert.deepEqual(mockInvalidateRunnerSession.mock.calls, [
    [session, 'transport_error_after_command_send'],
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'retained',
    reason: 'status_probe_failed',
  });
});

test('mutating commands keep invalidating when status reports an unknown lifecycle state', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({
      lifecycleState: 'paused',
    });

  await assert.rejects(
    () => runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /lifecycle status was "paused"/);
      assert.equal(error.details?.recovery, 'lifecycle_state_not_recoverable');
      assert.match(String(error.details?.hint), /conservative invalidation path/);
      return true;
    },
  );

  assert.deepEqual(mockInvalidateRunnerSession.mock.calls, [
    [session, 'transport_error_after_command_send'],
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'retained',
    reason: 'unknown_lifecycle_state',
    lifecycleState: 'paused',
  });
});

test('read-only commands retry when completed status has no retained response', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValue(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({ lifecycleState: 'completed' })
    .mockResolvedValueOnce({ nodes: [], truncated: false });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'snapshot' });

  assert.deepEqual(result, { nodes: [], truncated: false });
  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 3);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[2].command, 'status');
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[2]?.[2].command, 'snapshot');
  assertDiagnosticDecision({
    decision: 'skipped',
    reason: 'read_only_completed_without_retained_response',
    lifecycleState: 'completed',
  });
});

test('read-only startup commands use the session startup timeout override', async () => {
  const session = makeRunnerSession({
    port: 8100,
    ready: false,
    startupTimeoutMs: 240_000,
  });

  mockEnsureRunnerSession.mockResolvedValue(session);
  mockExecuteRunnerCommandWithSession.mockResolvedValue({ currentUptimeMs: 42 });

  const result = await runIosRunnerCommand(
    IOS_SIMULATOR,
    { command: 'uptime' },
    { startupTimeoutMs: 240_000 },
  );

  assert.deepEqual(result, { currentUptimeMs: 42 });
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[0]?.[4], 240_000);
});

test('read-only commands retry when status shows in-flight work', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValue(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({ lifecycleState: 'started' })
    .mockResolvedValueOnce({ nodes: [], truncated: false });

  const result = await runIosRunnerCommand(IOS_SIMULATOR, { command: 'snapshot' });

  assert.deepEqual(result, { nodes: [], truncated: false });
  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 3);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[1]?.[2].command, 'status');
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls[2]?.[2].command, 'snapshot');
});

test('mutating commands report recovery guidance when completed status has no retained response', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({ lifecycleState: 'completed' });

  await assert.rejects(
    () => runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /"tap" completed after the transport response was lost/);
      assert.equal(error.details?.recovery, 'completed_without_retained_response');
      assert.match(String(error.details?.hint), /kept the session open/);
      assert.match(String(error.details?.hint), /will not replay/);
      assert.match(String(error.details?.hint), /snapshot -i/);
      assert.equal(error.details?.transportError, 'fetch failed');
      return true;
    },
  );

  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'skipped',
    reason: 'completed_without_retained_response',
    lifecycleState: 'completed',
  });
});

test('mutating commands include skipped readiness context in lost-response guidance', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(
      new AppError('COMMAND_FAILED', 'fetch failed', {
        runnerReadinessPreflightSkipped: true,
        runnerReadinessPreflightSkipReason: 'recent_successful_response',
        runnerReadinessPreflightSkippedAgeMs: 4,
      }),
    )
    .mockResolvedValueOnce({ lifecycleState: 'completed' });

  await assert.rejects(
    () => runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.details?.recovery, 'completed_without_retained_response');
      assert.equal(error.details?.readinessPreflightSkipped, true);
      assert.equal(error.details?.readinessPreflightSkipReason, 'recent_successful_response');
      assert.equal(error.details?.readinessPreflightSkippedAgeMs, 4);
      assert.match(String(error.details?.hint), /skipped the uptime preflight/);
      assert.match(String(error.details?.hint), /status recovery confirmed/);
      assert.match(String(error.details?.hint), /snapshot -i/);
      return true;
    },
  );
});

test('mutating commands preserve runner failure details from status recovery', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({
      lifecycleState: 'failed',
      lifecycleErrorCode: 'AMBIGUOUS_MATCH',
      lifecycleErrorMessage: 'Found 2 matching buttons',
      lifecycleErrorHint: 'Use a more specific selector.',
    });

  await assert.rejects(
    () => runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.code, 'AMBIGUOUS_MATCH');
      assert.equal(error.message, 'Found 2 matching buttons');
      assert.equal(error.details?.recovery, 'runner_reported_failure');
      assert.equal(error.details?.hint, 'Use a more specific selector.');
      assert.equal(error.details?.transportError, 'fetch failed');
      return true;
    },
  );

  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'skipped',
    reason: 'runner_reported_failure',
    lifecycleState: 'failed',
  });
});

test('mutating commands use recovery guidance when failed status has no runner hint', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({
      lifecycleState: 'failed',
      lifecycleErrorMessage: 'Runner command failed after dispatch',
    });

  await assert.rejects(
    () => runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.equal(error.message, 'Runner command failed after dispatch');
      assert.match(String(error.details?.hint), /kept the session open/);
      assert.match(String(error.details?.hint), /did not replay/);
      return true;
    },
  );

  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assertDiagnosticDecision({
    decision: 'skipped',
    reason: 'runner_reported_failure',
    lifecycleState: 'failed',
  });
});

test('mutating commands report wait-and-inspect guidance when status shows in-flight work', async () => {
  const session = makeRunnerSession({ port: 8100, ready: true });

  mockEnsureRunnerSession.mockResolvedValueOnce(session);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({ lifecycleState: 'started' });

  await assert.rejects(
    () => runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
    (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.match(error.message, /"tap" is still started/);
      assert.equal(error.details?.recovery, 'command_still_in_flight');
      assert.match(String(error.details?.hint), /kept the session open/);
      assert.match(String(error.details?.hint), /snapshot -i/);
      assert.equal(error.details?.transportError, 'fetch failed');
      return true;
    },
  );

  assert.equal(mockInvalidateRunnerSession.mock.calls.length, 0);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 2);
  assertDiagnosticDecision({
    decision: 'skipped',
    reason: 'command_still_in_flight',
    lifecycleState: 'started',
  });
});

test('mutating commands invalidate the retry session without replaying again', async () => {
  const staleSession = makeRunnerSession({ port: 8100, ready: true });
  const freshSession = makeRunnerSession({ port: 8101, ready: false });

  mockEnsureRunnerSession.mockResolvedValueOnce(staleSession).mockResolvedValueOnce(freshSession);
  mockExecuteRunnerCommandWithSession
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'Runner did not accept connection'))
    .mockRejectedValueOnce(new AppError('COMMAND_FAILED', 'fetch failed'))
    .mockResolvedValueOnce({ lifecycleState: 'notAccepted' });

  await assert.rejects(() =>
    runIosRunnerCommand(IOS_SIMULATOR, { command: 'tap', x: 120, y: 240 }),
  );

  assert.equal(mockEnsureRunnerSession.mock.calls.length, 2);
  assert.deepEqual(mockInvalidateRunnerSession.mock.calls, [
    [staleSession, 'runner_connect_failed_before_command_send'],
    [freshSession, 'transport_error_after_retry_command_send'],
  ]);
  assert.equal(mockExecuteRunnerCommandWithSession.mock.calls.length, 3);
  assertDiagnosticDecision({
    decision: 'retained',
    reason: 'unknown_lifecycle_state',
    lifecycleState: 'notAccepted',
  });
});

function assertDiagnosticDecision(expected: {
  decision: 'skipped' | 'retained';
  reason: string;
  lifecycleState?: string;
}): void {
  assert.ok(
    mockEmitDiagnostic.mock.calls.some(([event]) => {
      return (
        event.phase === 'ios_runner_command_invalidation_decision' &&
        event.data?.decision === expected.decision &&
        event.data?.reason === expected.reason &&
        event.data?.lifecycleState === expected.lifecycleState
      );
    }),
    `missing invalidation decision diagnostic ${JSON.stringify(expected)}`,
  );
}

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

function makeRunnerArtifact(
  overrides: Partial<RunnerXctestrunArtifact> = {},
): RunnerXctestrunArtifact {
  return {
    xctestrunPath: '/tmp/runner.xctestrun',
    derived: '/tmp/derived',
    cache: 'exact',
    artifact: 'valid',
    buildMs: 0,
    xctestrunPathSource: 'manifest',
    ...overrides,
  };
}

async function captureDiagnostics(callback: () => Promise<void>): Promise<string> {
  await callback();
  return JSON.stringify(mockEmitDiagnostic.mock.calls.map(([event]) => event));
}
