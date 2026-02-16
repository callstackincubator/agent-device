import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../cli.ts';
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
    return { ok: true, data: {} };
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

test('help appstate prints command help and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'appstate']);
  assert.equal(result.code, 0);
  assert.equal(result.daemonCalls, 0);
  assert.match(result.stdout, /Show foreground app\/activity/);
  assert.doesNotMatch(result.stdout, /Command flags:/);
  assert.match(result.stdout, /Global flags:/);
});

test('appstate --help prints command help and skips daemon dispatch', async () => {
  const result = await runCliCapture(['appstate', '--help']);
  assert.equal(result.code, 0);
  assert.equal(result.daemonCalls, 0);
  assert.match(result.stdout, /Usage:\n  agent-device appstate/);
  assert.match(result.stdout, /Global flags:/);
});

test('help unknown command prints error plus global usage and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'not-a-command']);
  assert.equal(result.code, 1);
  assert.equal(result.daemonCalls, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): Unknown command: not-a-command/);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /Flags:/);
});

test('unknown command --help prints error plus global usage and skips daemon dispatch', async () => {
  const result = await runCliCapture(['not-a-command', '--help']);
  assert.equal(result.code, 1);
  assert.equal(result.daemonCalls, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): Unknown command: not-a-command/);
  assert.match(result.stdout, /Commands:/);
});

test('help rejects multiple positional commands and skips daemon dispatch', async () => {
  const result = await runCliCapture(['help', 'appstate', 'extra']);
  assert.equal(result.code, 1);
  assert.equal(result.daemonCalls, 0);
  assert.match(result.stderr, /Error \(INVALID_ARGS\): help accepts at most one command/);
});
