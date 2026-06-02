import { test, expect } from 'vitest';
import { finalizeDaemonResponse } from '../request-finalization.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';

test('finalizeDaemonResponse preserves handler error hints from details', () => {
  const req: DaemonRequest = {
    token: 'token',
    session: 'default',
    command: 'open',
    positionals: [],
    flags: {},
  };
  const response: DaemonResponse = {
    ok: false,
    error: {
      code: 'DEVICE_IN_USE',
      message: 'Device is already in use by session "default".',
      details: {
        session: 'default',
        hint: 'Run agent-device session list and reuse --session default.',
      },
    },
  };

  const finalized = finalizeDaemonResponse(req, response, () => 'artifact-id');

  expect(finalized.ok).toBe(false);
  if (!finalized.ok) {
    expect(finalized.error.hint).toBe('Run agent-device session list and reuse --session default.');
  }
});

test('finalizeDaemonResponse prefers top-level error hint over details hint', () => {
  const req: DaemonRequest = {
    token: 'token',
    session: 'default',
    command: 'open',
    positionals: [],
    flags: {},
  };
  const response: DaemonResponse = {
    ok: false,
    error: {
      code: 'DEVICE_IN_USE',
      message: 'Device is already in use by session "default".',
      hint: 'Use the top-level hint.',
      details: {
        hint: 'Use the details hint.',
      },
    },
  };

  const finalized = finalizeDaemonResponse(req, response, () => 'artifact-id');

  expect(finalized.ok).toBe(false);
  if (!finalized.ok) {
    expect(finalized.error.hint).toBe('Use the top-level hint.');
  }
});
