import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCli } from '../cli.ts';
import type { DaemonRequest, DaemonResponse } from '../daemon-client.ts';
import { resolveDaemonPaths } from '../daemon/config.ts';

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
    data: {
      app: 'settings',
      platform: 'ios',
      target: 'mobile',
      device: 'iPhone 16',
      id: 'SIM-001',
    },
  }));
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.command, 'open');
  assert.equal(result.calls[0]?.flags?.verbose, true);
  assert.equal(result.calls[0]?.meta?.debug, true);
  assert.equal(result.calls[0]?.meta?.cwd, process.cwd());
  assert.equal(typeof result.calls[0]?.meta?.requestId, 'string');
});

test('cli does not tail local daemon log when remote daemon base URL is set', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-cli-remote-'));
  const daemonPaths = resolveDaemonPaths(stateDir);
  fs.mkdirSync(path.dirname(daemonPaths.logPath), { recursive: true });
  fs.writeFileSync(daemonPaths.logPath, 'REMOTE_TAIL_SENTINEL\n', 'utf8');

  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://remote-mac.example.test:7777/agent-device';

  try {
    const result = await runCliCapture(
      ['clipboard', 'write', 'hello', '--debug', '--state-dir', stateDir],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 300));
        return {
          ok: true,
          data: { action: 'write', message: 'Clipboard updated' },
        };
      },
    );
    assert.equal(result.code, null);
    assert.equal(result.stdout.includes('REMOTE_TAIL_SENTINEL'), false);
    assert.match(result.stdout, /Clipboard updated/);
  } finally {
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
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

test('cli forwards save-script and no-record flags for client-backed open', async () => {
  const result = await runCliCapture(
    ['open', 'settings', '--save-script', '--no-record', '--json'],
    async () => ({
      ok: true,
      data: {
        app: 'settings',
        platform: 'ios',
        target: 'mobile',
        device: 'iPhone 16',
        id: 'SIM-001',
      },
    }),
  );
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.command, 'open');
  assert.equal(result.calls[0]?.flags?.saveScript, true);
  assert.equal(result.calls[0]?.flags?.noRecord, true);
});

test('cli preserves --out for client-backed screenshot', async () => {
  const result = await runCliCapture(
    ['screenshot', '--out', '/tmp/shot.png', '--json'],
    async () => ({
      ok: true,
      data: { path: '/tmp/shot.png' },
    }),
  );
  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.command, 'screenshot');
  assert.deepEqual(result.calls[0]?.positionals, ['/tmp/shot.png']);
});

test('cli applies AGENT_DEVICE_PLATFORM to client-backed commands', async () => {
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  process.env.AGENT_DEVICE_PLATFORM = 'android';
  try {
    const result = await runCliCapture(['open', 'com.example.app', '--json'], async () => ({
      ok: true,
      data: {
        app: 'com.example.app',
        platform: 'android',
        target: 'mobile',
        device: 'Pixel 9',
        id: 'emulator-5554',
      },
    }));
    assert.equal(result.code, null);
    assert.equal(result.calls[0]?.flags?.platform, 'android');
  } finally {
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
  }
});

test('cli prints success acknowledgment for client-backed open in human mode', async () => {
  const result = await runCliCapture(['open', 'settings'], async () => ({
    ok: true,
    data: {
      session: 'default',
      appName: 'Settings',
      message: 'Opened: Settings',
      platform: 'ios',
      target: 'mobile',
      device: 'iPhone 16',
      id: 'SIM-001',
    },
  }));
  assert.equal(result.code, null);
  assert.match(result.stdout, /Opened: Settings/);
});

test('cli prints success acknowledgment for client-backed close in human mode', async () => {
  const result = await runCliCapture(['close'], async () => ({
    ok: true,
    data: { session: 'default', message: 'Closed: default' },
  }));
  assert.equal(result.code, null);
  assert.match(result.stdout, /Closed: default/);
});

test('cli prints success acknowledgment for daemon-backed mutating commands in human mode', async () => {
  const result = await runCliCapture(['scroll', 'down'], async () => ({
    ok: true,
    data: { direction: 'down', message: 'Scrolled down' },
  }));
  assert.equal(result.code, null);
  assert.match(result.stdout, /Scrolled down/);
});

test('cli forwards bound-session lock policy when session defaults are configured', async () => {
  const previousSession = process.env.AGENT_DEVICE_SESSION;
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  process.env.AGENT_DEVICE_SESSION = 'qa-ios';
  process.env.AGENT_DEVICE_PLATFORM = 'ios';
  try {
    const result = await runCliCapture(['snapshot', '--device', 'Pixel 9', '--json'], async () => ({
      ok: true,
      data: {},
    }));
    assert.equal(result.code, null);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.meta?.lockPolicy, 'reject');
    assert.equal(result.calls[0]?.meta?.lockPlatform, 'ios');
    assert.equal(result.calls[0]?.flags?.platform, 'ios');
    assert.equal(result.calls[0]?.flags?.device, 'Pixel 9');
  } finally {
    if (previousSession === undefined) delete process.env.AGENT_DEVICE_SESSION;
    else process.env.AGENT_DEVICE_SESSION = previousSession;
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
  }
});

test('cli session lock flag overrides environment for a single invocation', async () => {
  const previousPlatform = process.env.AGENT_DEVICE_PLATFORM;
  const previousLocked = process.env.AGENT_DEVICE_SESSION_LOCKED;
  process.env.AGENT_DEVICE_PLATFORM = 'ios';
  process.env.AGENT_DEVICE_SESSION_LOCKED = '0';
  try {
    const result = await runCliCapture(
      ['snapshot', '--session-lock', 'reject', '--device', 'Pixel 9', '--json'],
      async () => ({
        ok: true,
        data: {},
      }),
    );
    assert.equal(result.code, null);
    assert.equal(result.calls.length, 1);
    assert.equal(result.calls[0]?.meta?.lockPolicy, 'reject');
  } finally {
    if (previousPlatform === undefined) delete process.env.AGENT_DEVICE_PLATFORM;
    else process.env.AGENT_DEVICE_PLATFORM = previousPlatform;
    if (previousLocked === undefined) delete process.env.AGENT_DEVICE_SESSION_LOCKED;
    else process.env.AGENT_DEVICE_SESSION_LOCKED = previousLocked;
  }
});
