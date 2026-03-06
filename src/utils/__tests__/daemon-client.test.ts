import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeDaemonCodeSignature,
  resolveDaemonRequestTimeoutMs,
  resolveDaemonStartupAttempts,
  resolveDaemonStartupHint,
  resolveDaemonStartupTimeoutMs,
  sendToDaemon,
} from '../../daemon-client.ts';
import { resolveDaemonPaths } from '../../daemon/config.ts';
import {
  isProcessAlive,
  readProcessCommand,
  stopProcessForTakeover,
  waitForProcessExit,
} from '../process-identity.ts';

test('resolveDaemonRequestTimeoutMs defaults to 90000', () => {
  assert.equal(resolveDaemonRequestTimeoutMs(undefined), 90000);
});

test('resolveDaemonRequestTimeoutMs enforces minimum timeout', () => {
  assert.equal(resolveDaemonRequestTimeoutMs('100'), 1000);
  assert.equal(resolveDaemonRequestTimeoutMs('2500'), 2500);
  assert.equal(resolveDaemonRequestTimeoutMs('invalid'), 90000);
});

test('resolveDaemonStartupTimeoutMs defaults to 15000', () => {
  assert.equal(resolveDaemonStartupTimeoutMs(undefined), 15000);
});

test('resolveDaemonStartupTimeoutMs enforces minimum timeout', () => {
  assert.equal(resolveDaemonStartupTimeoutMs('100'), 1000);
  assert.equal(resolveDaemonStartupTimeoutMs('20000'), 20000);
  assert.equal(resolveDaemonStartupTimeoutMs('invalid'), 15000);
});

test('resolveDaemonStartupAttempts defaults to 2', () => {
  assert.equal(resolveDaemonStartupAttempts(undefined), 2);
});

test('resolveDaemonStartupAttempts clamps values to [1,5]', () => {
  assert.equal(resolveDaemonStartupAttempts('0'), 1);
  assert.equal(resolveDaemonStartupAttempts('3'), 3);
  assert.equal(resolveDaemonStartupAttempts('999'), 5);
  assert.equal(resolveDaemonStartupAttempts('invalid'), 2);
});

test('resolveDaemonStartupHint prefers stale lock guidance when lock exists without info', () => {
  const hint = resolveDaemonStartupHint({ hasInfo: false, hasLock: true });
  assert.match(hint, /daemon\.lock/i);
  assert.match(hint, /delete/i);
});

test('resolveDaemonStartupHint covers stale info+lock pair', () => {
  const hint = resolveDaemonStartupHint({ hasInfo: true, hasLock: true });
  assert.match(hint, /daemon\.json/i);
  assert.match(hint, /daemon\.lock/i);
});

test('resolveDaemonStartupHint falls back to daemon.json guidance', () => {
  const hint = resolveDaemonStartupHint({ hasInfo: true, hasLock: false });
  assert.match(hint, /daemon\.json/i);
});

test('resolveDaemonStartupHint includes configured state directory paths', () => {
  const paths = resolveDaemonPaths('/tmp/ad-custom-state');
  const hint = resolveDaemonStartupHint({ hasInfo: false, hasLock: true }, paths);
  assert.match(hint, /\/tmp\/ad-custom-state\/daemon\.lock/);
  assert.match(hint, /\/tmp\/ad-custom-state\/daemon\.json/);
});

test('sendToDaemon uses explicit remote daemon base URL and auth token', async () => {
  let authHeader = '';
  let tokenHeader = '';
  let rpcRequest: Record<string, unknown> | null = null;
  const seenPaths: string[] = [];
  let healthcheckTimeout: number | undefined;
  const originalHttpRequest = http.request;
  (http as unknown as { request: typeof http.request }).request = ((options: any, callback: (res: any) => void) => {
    const req = new EventEmitter() as EventEmitter & {
      write: (chunk: string) => void;
      end: () => void;
      destroy: () => void;
    };
    let body = '';
    req.write = (chunk: string) => {
      body += chunk;
    };
    req.destroy = () => {
      req.emit('close');
    };
    req.end = () => {
      seenPaths.push(String(options.path ?? ''));
      if (options.method === 'GET') {
        healthcheckTimeout = Number(options.timeout);
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number;
          resume: () => void;
          setEncoding: (_encoding: string) => void;
        };
        res.statusCode = 200;
        res.resume = () => {};
        res.setEncoding = () => {};
        process.nextTick(() => {
          callback(res);
          res.emit('end');
        });
        return;
      }

      authHeader = String(options.headers?.authorization ?? '');
      tokenHeader = String(options.headers?.['x-agent-device-token'] ?? '');
      rpcRequest = JSON.parse(body) as Record<string, unknown>;
      const res = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        setEncoding: (_encoding: string) => void;
      };
      res.statusCode = 200;
      res.setEncoding = () => {};
      process.nextTick(() => {
        callback(res);
        res.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-remote',
          result: {
            ok: true,
            data: { source: 'remote-daemon' },
          },
        }));
        res.emit('end');
      });
    };
    return req as any;
  }) as typeof http.request;

  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://remote-mac.example.test:7777/agent-device';
  process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'remote-secret';

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'remote-smoke',
      positionals: ['ping'],
      flags: {},
      meta: { requestId: 'req-remote' },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(response.data, { source: 'remote-daemon' });
    assert.deepEqual(seenPaths, ['/agent-device/health', '/agent-device/rpc']);
    assert.equal(healthcheckTimeout, 3000);
    assert.equal(authHeader, 'Bearer remote-secret');
    assert.equal(tokenHeader, 'remote-secret');
    assert.equal((rpcRequest as any)?.method, 'agent_device.command');
    assert.equal((rpcRequest as any)?.params?.command, 'remote-smoke');
    assert.deepEqual((rpcRequest as any)?.params?.positionals, ['ping']);
    assert.equal((rpcRequest as any)?.params?.token, 'remote-secret');
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon rejects socket transport when remote daemon base URL is set', async () => {
  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://127.0.0.1:4310/agent-device';

  try {
    await assert.rejects(
      async () => await sendToDaemon({
        session: 'default',
        command: 'remote-smoke',
        positionals: [],
        flags: { daemonTransport: 'socket' },
        meta: { requestId: 'req-remote-socket' },
      }),
      /only supports HTTP transport/,
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
  }
});

test('computeDaemonCodeSignature includes relative path, size, and mtime', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-daemon-signature-'));
  try {
    const daemonEntryPath = path.join(root, 'dist', 'src', 'daemon.js');
    fs.mkdirSync(path.dirname(daemonEntryPath), { recursive: true });
    fs.writeFileSync(daemonEntryPath, 'console.log("daemon");\n', 'utf8');
    const signature = computeDaemonCodeSignature(daemonEntryPath, root);
    assert.match(signature, /^dist\/src\/daemon\.js:\d+:\d+$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDaemonProcessForTakeover terminates a matching daemon process', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-daemon-test-'));
  const daemonDir = path.join(root, 'agent-device', 'dist', 'src');
  const daemonScriptPath = path.join(daemonDir, 'daemon.js');
  fs.mkdirSync(daemonDir, { recursive: true });
  fs.writeFileSync(daemonScriptPath, 'setInterval(() => {}, 1000);\n', 'utf8');
  const child = spawn(process.execPath, [daemonScriptPath], {
    stdio: 'ignore',
  });
  const pid = child.pid;
  assert.ok(pid, 'spawned child should have a pid');

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (readProcessCommand(pid) === null) {
      t.skip('process command inspection is unavailable in this environment');
      return;
    }
    assert.equal(isProcessAlive(pid), true);
    await stopProcessForTakeover(pid, {
      termTimeoutMs: 1_500,
      killTimeoutMs: 1_500,
    });
    const exited = await waitForProcessExit(pid, 1500);
    assert.equal(exited, true);
  } finally {
    if (isProcessAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDaemonProcessForTakeover does not terminate non-daemon process', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  const pid = child.pid;
  assert.ok(pid, 'spawned child should have a pid');

  try {
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(isProcessAlive(pid), true);
    await stopProcessForTakeover(pid, {
      termTimeoutMs: 100,
      killTimeoutMs: 100,
    });
    assert.equal(isProcessAlive(pid), true);
  } finally {
    if (isProcessAlive(pid)) {
      process.kill(pid, 'SIGKILL');
    }
  }
});
