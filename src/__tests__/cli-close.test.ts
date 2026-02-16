import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../cli.ts';
import { AppError } from '../utils/errors.ts';
import type { DaemonResponse } from '../daemon-client.ts';

class ExitSignal extends Error {
  public readonly code: number;

  constructor(code: number) {
    super(`EXIT_${code}`);
    this.code = code;
  }
}

type RunResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  daemonCalls: number;
};

async function runCliCapture(argv: string[]): Promise<RunResult> {
  let daemonCalls = 0;
  let stdout = '';
  let stderr = '';
  let code: number | null = null;

  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  (process as any).exit = ((nextCode?: number) => {
    throw new ExitSignal(nextCode ?? 0);
  }) as typeof process.exit;
  (process.stdout as any).write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as any).write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const sendToDaemon = async (): Promise<DaemonResponse> => {
    daemonCalls += 1;
    throw new AppError('COMMAND_FAILED', 'Failed to start daemon', {
      infoPath: '/tmp/daemon.json',
      hint: 'stale daemon info',
    });
  };

  try {
    await runCli(argv, { sendToDaemon });
  } catch (error) {
    if (error instanceof ExitSignal) code = error.code;
    else throw error;
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return { code, stdout, stderr, daemonCalls };
}

async function runCliCaptureWithErrorDetails(
  argv: string[],
  details: Record<string, unknown>,
  message = 'Failed to start daemon',
): Promise<RunResult> {
  let daemonCalls = 0;
  let stdout = '';
  let stderr = '';
  let code: number | null = null;

  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  (process as any).exit = ((nextCode?: number) => {
    throw new ExitSignal(nextCode ?? 0);
  }) as typeof process.exit;
  (process.stdout as any).write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as any).write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;

  const sendToDaemon = async (): Promise<DaemonResponse> => {
    daemonCalls += 1;
    throw new AppError('COMMAND_FAILED', message, details);
  };

  try {
    await runCli(argv, { sendToDaemon });
  } catch (error) {
    if (error instanceof ExitSignal) code = error.code;
    else throw error;
  } finally {
    process.exit = originalExit;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }

  return { code, stdout, stderr, daemonCalls };
}

test('close treats daemon startup failure as no-op', async () => {
  const result = await runCliCapture(['close']);
  assert.equal(result.code, null);
  assert.equal(result.daemonCalls, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('close --json treats daemon startup failure as no-op success', async () => {
  const result = await runCliCapture(['close', '--json']);
  assert.equal(result.code, null);
  assert.equal(result.daemonCalls, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.success, true);
  assert.equal(payload.data.closed, 'session');
  assert.equal(payload.data.source, 'no-daemon');
  assert.equal(result.stderr, '');
});

test('close treats lock-only daemon startup failure as no-op', async () => {
  const result = await runCliCaptureWithErrorDetails(['close'], {
    lockPath: '/tmp/daemon.lock',
    hint: 'stale daemon lock',
  });
  assert.equal(result.code, null);
  assert.equal(result.daemonCalls, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('close treats structured daemon startup failure as no-op without relying on message text', async () => {
  const result = await runCliCaptureWithErrorDetails(
    ['close'],
    {
      kind: 'daemon_startup_failed',
      lockPath: '/tmp/daemon.lock',
    },
    'daemon bootstrap failed',
  );
  assert.equal(result.code, null);
  assert.equal(result.daemonCalls, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});
