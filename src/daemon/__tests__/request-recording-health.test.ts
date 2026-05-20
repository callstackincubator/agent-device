import { test, expect, vi, beforeEach } from 'vitest';
import type { SessionState } from '../types.ts';

vi.mock('../../platforms/ios/runner-client.ts', () => ({
  getRunnerSessionSnapshot: vi.fn(),
}));

import { getRunnerSessionSnapshot } from '../../platforms/ios/runner-client.ts';
import { refreshRecordingHealth } from '../request-recording-health.ts';

const mockGetRunnerSessionSnapshot = vi.mocked(getRunnerSessionSnapshot);

beforeEach(() => {
  mockGetRunnerSessionSnapshot.mockReset();
});

function makeIosSimulatorSession(showTouches: boolean): SessionState {
  return {
    name: 'default',
    createdAt: Date.now(),
    actions: [],
    device: {
      platform: 'ios',
      target: 'mobile',
      id: 'sim-1',
      name: 'iPhone 17 Pro',
      kind: 'simulator',
      booted: true,
    },
    recording: {
      platform: 'ios',
      outPath: '/tmp/demo.mp4',
      startedAt: Date.now() - 1_000,
      showTouches,
      gestureEvents: [],
      runnerSessionId: 'runner-before',
      child: { kill: () => true },
      wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
    },
  };
}

test('raw iOS simulator recordings do not depend on runner health', () => {
  const session = makeIosSimulatorSession(false);
  mockGetRunnerSessionSnapshot.mockReturnValue({
    alive: true,
    sessionId: 'runner-after',
  });

  refreshRecordingHealth(session);

  expect(mockGetRunnerSessionSnapshot).not.toHaveBeenCalled();
  expect(session.recording?.invalidatedReason).toBeUndefined();
});

test('touch-overlay iOS simulator recordings are invalidated by runner restarts', () => {
  const session = makeIosSimulatorSession(true);
  mockGetRunnerSessionSnapshot.mockReturnValue({
    alive: true,
    sessionId: 'runner-after',
  });

  refreshRecordingHealth(session);

  expect(mockGetRunnerSessionSnapshot).toHaveBeenCalledWith('sim-1');
  expect(session.recording?.invalidatedReason).toBe(
    'iOS runner session restarted during recording',
  );
});
