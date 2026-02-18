import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  options: { forceStdinTty?: boolean } = {},
): Promise<RunResult> {
  let stdout = '';
  let stderr = '';
  let code: number | null = null;
  const calls: Array<Omit<DaemonRequest, 'token'>> = [];

  const originalExit = process.exit;
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');

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
  if (options.forceStdinTty !== undefined) {
    Object.defineProperty(process.stdin, 'isTTY', {
      configurable: true,
      value: options.forceStdinTty,
    });
  }

  const sendToDaemon = async (req: Omit<DaemonRequest, 'token'>): Promise<DaemonResponse> => {
    calls.push(req);
    return { ok: true, data: { total: 1, executed: 1, totalDurationMs: 1 } };
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
    if (options.forceStdinTty !== undefined) {
      if (stdinDescriptor) {
        Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
      } else {
        delete (process.stdin as any).isTTY;
      }
    }
  }

  return { code, stdout, stderr, calls };
}

test('batch --steps parses JSON and forwards batchSteps only', async () => {
  const result = await runCliCapture([
    'batch',
    '--session',
    'sim',
    '--platform',
    'ios',
    '--steps',
    '[{"command":"open","positionals":["settings"]}]',
    '--json',
  ]);
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  const req = result.calls[0];
  assert.equal(req.command, 'batch');
  assert.equal(req.session, 'sim');
  assert.equal(req.flags?.platform, 'ios');
  assert.ok(Array.isArray(req.flags?.batchSteps));
  assert.equal((req.flags?.batchSteps ?? [])[0]?.command, 'open');
  assert.equal(Object.hasOwn(req.flags ?? {}, 'steps'), false);
});

test('batch --steps-file parses file payload', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-batch-'));
  const stepsPath = path.join(tmpDir, 'steps.json');
  fs.writeFileSync(stepsPath, JSON.stringify([{ command: 'wait', positionals: ['100'] }]), 'utf8');
  const result = await runCliCapture(['batch', '--steps-file', stepsPath, '--json']);
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  const req = result.calls[0];
  assert.equal(req.command, 'batch');
  assert.equal((req.flags?.batchSteps ?? [])[0]?.command, 'wait');
});

test('batch --steps-stdin fails fast when stdin is TTY', async () => {
  const result = await runCliCapture(['batch', '--steps-stdin'], { forceStdinTty: true });
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /--steps-stdin requires piped JSON input/);
});
