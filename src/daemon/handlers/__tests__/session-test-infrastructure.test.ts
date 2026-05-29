import { test } from 'vitest';
import assert from 'node:assert/strict';
import { isReplayInfrastructureFailure } from '../session-test-infrastructure.ts';
import type { DaemonResponse } from '../../types.ts';

test('isReplayInfrastructureFailure accepts shared boot diagnostic reasons', () => {
  const response: DaemonResponse = {
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message: 'Runner startup failed',
      details: { reason: 'IOS_RUNNER_CONNECT_TIMEOUT' },
    },
  };

  assert.equal(isReplayInfrastructureFailure(response), true);
});

test('isReplayInfrastructureFailure keeps message fallback for legacy errors', () => {
  const response: DaemonResponse = {
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message: 'Runner did not accept connection',
    },
  };

  assert.equal(isReplayInfrastructureFailure(response), true);
});

test('isReplayInfrastructureFailure accepts replay timeout cleanup races', () => {
  const response: DaemonResponse = {
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message: 'TIMEOUT after 120000ms',
      details: { reason: 'timeout_cleanup_pending', timeoutCleanupPending: true },
    },
  };

  assert.equal(isReplayInfrastructureFailure(response), true);
});

test('isReplayInfrastructureFailure rejects normal replay failures', () => {
  const response: DaemonResponse = {
    ok: false,
    error: {
      code: 'ELEMENT_NOT_FOUND',
      message: 'Maestro selector did not match: text="Settings"',
      details: { reason: 'selector_not_found' },
    },
  };

  assert.equal(isReplayInfrastructureFailure(response), false);
});
