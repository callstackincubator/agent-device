import assert from 'node:assert/strict';
import { beforeEach, test, vi } from 'vitest';
import { IOS_SIMULATOR } from '../../../__tests__/test-utils/index.ts';
import { AppError } from '../../../utils/errors.ts';
import type { RunnerSession } from '../runner-session-types.ts';

const { mockSendRunnerCommandOnce, mockWaitForRunner } = vi.hoisted(() => ({
  mockSendRunnerCommandOnce: vi.fn(),
  mockWaitForRunner: vi.fn(),
}));

vi.mock('../runner-transport.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../runner-transport.ts')>('../runner-transport.ts');
  return {
    ...actual,
    sendRunnerCommandOnce: mockSendRunnerCommandOnce,
    waitForRunner: mockWaitForRunner,
  };
});

import { executeRunnerCommandWithSession } from '../runner-session.ts';

beforeEach(() => {
  vi.resetAllMocks();
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

function runnerResponse(data: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ ok: true, data }));
}

function runnerError(error: { code: string; message: string }): Response {
  return new Response(JSON.stringify({ ok: false, error }));
}
