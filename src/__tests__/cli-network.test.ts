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

test('network dump prints parsed entries and metadata', async () => {
  const result = await runCliCapture(['network', 'dump', '10', 'all'], async () => ({
    ok: true,
    data: {
      path: '/tmp/app.log',
      include: 'all',
      active: true,
      state: 'active',
      backend: 'android',
      scannedLines: 120,
      matchedLines: 2,
      entries: [
        {
          timestamp: '2026-02-24T10:00:01Z',
          method: 'POST',
          url: 'https://api.example.com/v1/login',
          status: 401,
          headers: '{"x-id":"abc"}',
          requestBody: '{"email":"u@example.com"}',
          responseBody: '{"error":"denied"}',
        },
      ],
      notes: ['best-effort parser'],
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.deepEqual(result.calls[0]?.positionals, ['dump', '10', 'all']);
  assert.match(result.stdout, /\/tmp\/app\.log/);
  assert.match(result.stdout, /POST https:\/\/api\.example\.com\/v1\/login status=401/);
  assert.match(result.stdout, /headers:/);
  assert.match(result.stdout, /request:/);
  assert.match(result.stdout, /response:/);
  assert.match(result.stderr, /active=true/);
  assert.match(result.stderr, /include=all/);
  assert.match(result.stderr, /matchedLines=2/);
  assert.match(result.stderr, /best-effort parser/);
});
