import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../cli.ts';
import type { DaemonRequest, DaemonResponse } from '../daemon-client.ts';

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
  calls: Omit<DaemonRequest, 'token'>[];
};

async function runCliCapture(
  argv: string[],
  responder: (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse>,
): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  let code: number | null = null;
  const calls: Array<Omit<DaemonRequest, 'token'>> = [];

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

  const sendToDaemon = async (req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> => {
    calls.push(req);
    return await responder(req);
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

  return { code, stdout, stderr, calls };
}

test('cli forwards --debug as verbose/debug metadata', async () => {
  const result = await runCliCapture(['open', 'settings', '--debug', '--json'], async () => ({
    ok: true,
    data: { app: 'settings' },
  }));
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.flags?.verbose, true);
  assert.equal(result.calls[0]?.meta?.debug, true);
  assert.equal(typeof result.calls[0]?.meta?.requestId, 'string');
});

test('cli returns normalized JSON failures with diagnostics fields', async () => {
  const result = await runCliCapture(['open', 'settings', '--json'], async () => ({
    ok: false,
    error: {
      code: 'COMMAND_FAILED',
      message: 'boom',
      hint: 'retry later',
      diagnosticId: 'diag-123',
      logPath: '/tmp/diag.ndjson',
      details: { token: 'secret', safe: 'ok' },
    },
  }));
  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.success, false);
  assert.equal(payload.error.code, 'COMMAND_FAILED');
  assert.equal(payload.error.hint, 'retry later');
  assert.equal(payload.error.diagnosticId, 'diag-123');
  assert.equal(payload.error.logPath, '/tmp/diag.ndjson');
  assert.equal(payload.error.details.token, '[REDACTED]');
  assert.equal(payload.error.details.safe, 'ok');
});

test('cli parse failures include diagnostic references in JSON mode', async () => {
  const previousHome = process.env.HOME;
  process.env.HOME = '/tmp';
  try {
    const result = await runCliCapture(['open', '--unknown-flag', '--json'], async () => ({
      ok: true,
      data: {},
    }));
    assert.equal(result.code, 1);
    assert.equal(result.calls.length, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.success, false);
    assert.equal(payload.error.code, 'INVALID_ARGS');
    assert.equal(typeof payload.error.diagnosticId, 'string');
    assert.equal(typeof payload.error.logPath, 'string');
  } finally {
    process.env.HOME = previousHome;
  }
});
