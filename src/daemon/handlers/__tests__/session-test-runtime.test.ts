import { afterEach, expect, test, vi } from 'vitest';
import type { DaemonResponse } from '../../types.ts';
import { isRequestCanceled } from '../../request-cancel.ts';
import { runReplayTestAttempt } from '../session-test-runtime.ts';

afterEach(() => {
  vi.useRealTimers();
});

test('runReplayTestAttempt keeps cancellation active until a timed-out replay settles', async () => {
  vi.useFakeTimers();

  let resolveReplay: ((response: DaemonResponse) => void) | undefined;
  const replayPromise = new Promise<DaemonResponse>((resolve) => {
    resolveReplay = resolve;
  });
  const replaySettled = replayPromise.then(() => undefined);
  const cleanupSession = vi.fn(async () => {});

  const attemptPromise = runReplayTestAttempt({
    filePath: '01-timeout.ad',
    sessionName: 'default:test:timeout',
    requestId: 'req-timeout-open',
    timeoutMs: 10,
    runReplay: async () => await replayPromise,
    cleanupSession,
  });

  await vi.advanceTimersByTimeAsync(10);
  await vi.advanceTimersByTimeAsync(2_000);

  const result = await attemptPromise;
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.message).toContain('TIMEOUT after 10ms');
  }
  expect(cleanupSession).toHaveBeenCalledWith('default:test:timeout');
  expect(isRequestCanceled('req-timeout-open')).toBe(true);

  resolveReplay?.({
    ok: false,
    error: { code: 'COMMAND_FAILED', message: 'request canceled' },
  });
  await replaySettled;
  await Promise.resolve();
  await Promise.resolve();

  expect(isRequestCanceled('req-timeout-open')).toBe(false);
});
