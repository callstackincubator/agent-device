import { test } from 'vitest';
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
  responder?: (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse>,
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
    if (responder) {
      return await responder(req);
    }
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

test('batch --steps-file returns clear error for missing file', async () => {
  const result = await runCliCapture([
    'batch',
    '--steps-file',
    '/tmp/definitely-missing-batch-steps.json',
  ]);
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Failed to read --steps-file/);
});

test('batch --steps-file rejects invalid JSON payload', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-batch-invalid-'));
  const stepsPath = path.join(tmpDir, 'steps.json');
  fs.writeFileSync(stepsPath, '{"command":"open"', 'utf8');
  const result = await runCliCapture(['batch', '--steps-file', stepsPath]);
  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 0);
  assert.match(result.stderr, /Batch steps must be valid JSON/);
});

test('batch forwards strip lock policy for nested steps when bound session uses strip mode', async () => {
  const previousSession = process.env.AGENT_DEVICE_SESSION;
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  const previousLock = process.env.AGENT_DEVICE_SESSION_LOCK;
  process.env.AGENT_DEVICE_SESSION = 'qa-ios';
  process.env.AGENT_DEVICE_PLATFORM = 'ios';
  process.env.AGENT_DEVICE_SESSION_LOCK = 'strip';

  try {
    const result = await runCliCapture([
      'batch',
      '--steps',
      '[{"command":"snapshot","flags":{"platform":"android","serial":"emulator-5554"}}]',
      '--json',
    ]);
    assert.equal(result.code, null);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.meta?.lockPolicy, 'strip');
    assert.equal(result.calls[0]?.meta?.lockPlatform, 'ios');
    const stepFlags = (result.calls[0]?.flags?.batchSteps ?? [])[0]?.flags ?? {};
    assert.equal(stepFlags.platform, 'android');
    assert.equal(stepFlags.serial, 'emulator-5554');
  } finally {
    if (previousSession === undefined) delete process.env.AGENT_DEVICE_SESSION;
    else process.env.AGENT_DEVICE_SESSION = previousSession;
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
    if (previousLock === undefined) delete process.env.AGENT_DEVICE_SESSION_LOCK;
    else process.env.AGENT_DEVICE_SESSION_LOCK = previousLock;
  }
});

test('batch forwards reject lock policy for target retargeting', async () => {
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  const previousLocked = process.env.AGENT_DEVICE_SESSION_LOCKED;
  process.env.AGENT_DEVICE_PLATFORM = 'ios';
  process.env.AGENT_DEVICE_SESSION_LOCKED = '1';

  try {
    const result = await runCliCapture([
      'batch',
      '--steps',
      '[{"command":"open","flags":{"target":"tv"}}]',
      '--json',
    ]);
    assert.equal(result.code, null);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.meta?.lockPolicy, 'reject');
    const stepFlags = (result.calls[0]?.flags?.batchSteps ?? [])[0]?.flags ?? {};
    assert.equal(stepFlags.target, 'tv');
  } finally {
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
    if (previousLocked === undefined) delete process.env.AGENT_DEVICE_SESSION_LOCKED;
    else process.env.AGENT_DEVICE_SESSION_LOCKED = previousLocked;
  }
});

test('batch session lock flags apply to nested steps without env configuration', async () => {
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  const previousLocked = process.env.AGENT_DEVICE_SESSION_LOCKED;
  process.env.AGENT_DEVICE_PLATFORM = 'ios';
  process.env.AGENT_DEVICE_SESSION_LOCKED = '0';

  try {
    const result = await runCliCapture([
      'batch',
      '--session-lock',
      'strip',
      '--steps',
      '[{"command":"snapshot","flags":{"target":"tv","serial":"emulator-5554"}}]',
      '--json',
    ]);
    assert.equal(result.code, null);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.meta?.lockPolicy, 'strip');
    assert.equal(result.calls[0]?.meta?.lockPlatform, 'ios');
    assert.equal(result.calls[0]?.flags?.platform, 'ios');
    const stepFlags = (result.calls[0]?.flags?.batchSteps ?? [])[0]?.flags ?? {};
    assert.equal(stepFlags.platform, 'ios');
    assert.equal(stepFlags.target, 'tv');
    assert.equal(stepFlags.serial, 'emulator-5554');
  } finally {
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
    if (previousLocked === undefined) delete process.env.AGENT_DEVICE_SESSION_LOCKED;
    else process.env.AGENT_DEVICE_SESSION_LOCKED = previousLocked;
  }
});

test('batch step without explicit platform inherits parent platform over env default', async () => {
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  process.env.AGENT_DEVICE_PLATFORM = 'ios';

  try {
    const result = await runCliCapture([
      'batch',
      '--platform',
      'android',
      '--steps',
      '[{"command":"snapshot"}]',
      '--json',
    ]);
    assert.equal(result.code, null);
    assert.equal(result.calls.length, 1);
    const stepFlags = (result.calls[0]?.flags?.batchSteps ?? [])[0]?.flags ?? {};
    assert.equal(stepFlags.platform, 'android');
  } finally {
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
  }
});

test('batch human output renders per-step results', async () => {
  const result = await runCliCapture(['batch', '--steps', '[{"command":"open"}]'], async () => ({
    ok: true,
    data: {
      total: 2,
      executed: 2,
      totalDurationMs: 15,
      results: [
        {
          step: 1,
          command: 'open',
          ok: true,
          data: { appName: 'Settings', message: 'Opened: Settings' },
          durationMs: 7,
        },
        {
          step: 2,
          command: 'type',
          ok: true,
          data: { text: 'hello', message: 'Typed 5 chars' },
          durationMs: 8,
        },
      ],
    },
  }));

  assert.equal(result.code, null);
  assert.match(result.stdout, /Batch completed: 2\/2 steps in 15ms/);
  assert.match(result.stdout, /1\. OK Opened: Settings \(7ms\)/);
  assert.match(result.stdout, /2\. OK Typed 5 chars \(8ms\)/);
});

test('batch human output renders failed steps distinctly', async () => {
  const result = await runCliCapture(['batch', '--steps', '[{"command":"open"}]'], async () => ({
    ok: true,
    data: {
      total: 2,
      executed: 1,
      totalDurationMs: 15,
      results: [
        {
          step: 1,
          command: 'open',
          ok: true,
          data: { appName: 'Settings', message: 'Opened: Settings' },
          durationMs: 7,
        },
        {
          step: 2,
          command: 'type',
          ok: false,
          error: { message: 'type requires text' },
          durationMs: 8,
        },
      ],
    },
  }));

  assert.equal(result.code, null);
  assert.match(result.stdout, /1\. OK Opened: Settings \(7ms\)/);
  assert.match(result.stdout, /2\. FAILED type requires text \(8ms\)/);
});
