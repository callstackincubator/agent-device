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

async function runCliCapture(argv: string[]): Promise<RunResult> {
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
    return {
      ok: true,
      data: {
        mode: 'snapshot',
        baselineInitialized: false,
        summary: { additions: 1, removals: 1, unchanged: 1 },
        lines: [
          { kind: 'unchanged', text: '@e2 [window]' },
          { kind: 'removed', text: '  @e3 [text] "67"' },
          { kind: 'added', text: '  @e3 [text] "134"' },
        ],
      },
    };
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

test('diff snapshot renders human-readable unified diff text', async () => {
  const result = await runCliCapture(['diff', 'snapshot']);
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.match(result.stdout, /^@e2 \[window\]/m);
  assert.match(result.stdout, /^-  @e3 \[text\] "67"$/m);
  assert.match(result.stdout, /^\+  @e3 \[text\] "134"$/m);
  assert.match(result.stdout, /1 additions, 1 removals, 1 unchanged/);
  assert.equal(result.stderr, '');
});

test('diff snapshot --json passes daemon payload through unchanged', async () => {
  const result = await runCliCapture(['diff', 'snapshot', '--json']);
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.success, true);
  assert.equal(payload.data.mode, 'snapshot');
  assert.equal(payload.data.baselineInitialized, false);
  assert.equal(Array.isArray(payload.data.lines), true);
  assert.equal(result.stderr, '');
});
