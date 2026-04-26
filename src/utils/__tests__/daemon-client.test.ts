import { test } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import {
  computeDaemonCodeSignature,
  downloadRemoteArtifact,
  openApp,
  resolveDaemonRequestTimeoutForCommand,
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

let loopbackBindSupportPromise: Promise<boolean> | null = null;

async function supportsLoopbackBind(): Promise<boolean> {
  if (loopbackBindSupportPromise) {
    return await loopbackBindSupportPromise;
  }
  loopbackBindSupportPromise = new Promise<boolean>((resolve) => {
    const server = http.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
  return await loopbackBindSupportPromise;
}

test('daemon timeout and retry helpers normalize configured values', () => {
  const scenarios: Array<{
    resolve: (value: string | undefined) => number;
    cases: Array<{ value: string | undefined; expected: number }>;
  }> = [
    {
      resolve: resolveDaemonRequestTimeoutMs,
      cases: [
        { value: undefined, expected: 90000 },
        { value: '100', expected: 1000 },
        { value: '2500', expected: 2500 },
        { value: 'invalid', expected: 90000 },
      ],
    },
    {
      resolve: resolveDaemonStartupTimeoutMs,
      cases: [
        { value: undefined, expected: 15000 },
        { value: '100', expected: 1000 },
        { value: '20000', expected: 20000 },
        { value: 'invalid', expected: 15000 },
      ],
    },
    {
      resolve: resolveDaemonStartupAttempts,
      cases: [
        { value: undefined, expected: 2 },
        { value: '0', expected: 1 },
        { value: '3', expected: 3 },
        { value: '999', expected: 5 },
        { value: 'invalid', expected: 2 },
      ],
    },
  ];

  for (const scenario of scenarios) {
    for (const testCase of scenario.cases) {
      assert.equal(scenario.resolve(testCase.value), testCase.expected);
    }
  }
});

test('test command opts out of the daemon request timeout', () => {
  assert.equal(resolveDaemonRequestTimeoutForCommand('open', '2500'), 2500);
  assert.equal(resolveDaemonRequestTimeoutForCommand('test', '2500'), undefined);
  assert.equal(resolveDaemonRequestTimeoutForCommand(undefined, '2500'), 2500);
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
  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: (res: any) => void,
  ) => {
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
        res.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-remote',
            result: {
              ok: true,
              data: { source: 'remote-daemon' },
            },
          }),
        );
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

test('sendToDaemon sends lease helpers as top-level JSON-RPC methods over HTTP', async () => {
  const rpcRequests: Record<string, unknown>[] = [];
  const originalHttpRequest = http.request;
  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: (res: any) => void,
  ) => {
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
        if (options.method === 'GET') {
          res.emit('end');
          return;
        }
        const rpcRequest = JSON.parse(body) as Record<string, any>;
        rpcRequests.push(rpcRequest);
        res.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpcRequest.id,
            result: {
              ok: true,
              data: {
                lease:
                  rpcRequest.method === 'agent_device.lease.release'
                    ? undefined
                    : {
                        leaseId: 'lease-new',
                        tenantId: rpcRequest.params?.tenantId,
                        runId: rpcRequest.params?.runId,
                        backend: rpcRequest.params?.backend,
                      },
                released: rpcRequest.method === 'agent_device.lease.release' ? true : undefined,
              },
            },
          }),
        );
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
    const allocateResponse = await sendToDaemon({
      session: 'qa-android',
      command: 'lease_allocate',
      positionals: [],
      flags: {},
      meta: {
        requestId: 'lease-req',
        tenantId: 'acme',
        runId: 'run-123',
        leaseBackend: 'android-instance',
        leaseTtlMs: 30_000,
      },
    });
    const heartbeatResponse = await sendToDaemon({
      session: 'qa-android',
      command: 'lease_heartbeat',
      positionals: [],
      flags: {},
      meta: {
        requestId: 'heartbeat-req',
        tenantId: 'acme',
        runId: 'run-123',
        leaseId: 'lease-new',
        leaseTtlMs: 15_000,
      },
    });
    const releaseResponse = await sendToDaemon({
      session: 'qa-android',
      command: 'lease_release',
      positionals: [],
      flags: {},
      meta: {
        requestId: 'release-req',
        tenantId: 'acme',
        runId: 'run-123',
        leaseId: 'lease-new',
      },
    });

    assert.equal(allocateResponse.ok, true);
    assert.equal(heartbeatResponse.ok, true);
    assert.equal(releaseResponse.ok, true);
    assert.equal(rpcRequests.length, 3);
    assert.equal(rpcRequests[0]?.method, 'agent_device.lease.allocate');
    assert.deepEqual(rpcRequests[0]?.params, {
      session: 'qa-android',
      tenantId: 'acme',
      runId: 'run-123',
      ttlMs: 30_000,
      backend: 'android-instance',
    });
    assert.equal(rpcRequests[1]?.method, 'agent_device.lease.heartbeat');
    assert.deepEqual(rpcRequests[1]?.params, {
      session: 'qa-android',
      tenantId: 'acme',
      runId: 'run-123',
      leaseId: 'lease-new',
      ttlMs: 15_000,
    });
    assert.equal(rpcRequests[2]?.method, 'agent_device.lease.release');
    assert.deepEqual(rpcRequests[2]?.params, {
      session: 'qa-android',
      tenantId: 'acme',
      runId: 'run-123',
      leaseId: 'lease-new',
    });
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('openApp forwards typed runtime hints on open requests', async () => {
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;
  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: (res: any) => void,
  ) => {
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
      if (options.method === 'GET') {
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

      rpcRequest = JSON.parse(body) as Record<string, unknown>;
      const res = new EventEmitter() as EventEmitter & {
        statusCode?: number;
        setEncoding: (_encoding: string) => void;
      };
      res.statusCode = 200;
      res.setEncoding = () => {};
      process.nextTick(() => {
        callback(res);
        res.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-open-app',
            result: {
              ok: true,
              data: { launched: true },
            },
          }),
        );
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
    const runtime = {
      metroHost: '10.0.2.2',
      metroPort: 8081,
      launchUrl: 'myapp://debug',
    };

    const response = await openApp({
      session: 'qa-session',
      app: 'Demo',
      platform: 'android',
      relaunch: true,
      runtime,
      meta: { requestId: 'req-open-app' },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(response.data, { launched: true });
    assert.equal((rpcRequest as any)?.method, 'agent_device.command');
    assert.equal((rpcRequest as any)?.params?.command, 'open');
    assert.equal((rpcRequest as any)?.params?.session, 'qa-session');
    assert.deepEqual((rpcRequest as any)?.params?.positionals, ['Demo']);
    assert.deepEqual((rpcRequest as any)?.params?.flags, {
      platform: 'android',
      relaunch: true,
    });
    assert.deepEqual((rpcRequest as any)?.params?.runtime, runtime);
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
      async () =>
        await sendToDaemon({
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

test('sendToDaemon treats IPv4-mapped loopback remote daemon URLs as local', async () => {
  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://[::ffff:127.0.0.1]:4310/agent-device';
  delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;

  try {
    await assert.rejects(
      async () =>
        await sendToDaemon({
          session: 'default',
          command: 'remote-smoke',
          positionals: [],
          flags: { daemonTransport: 'socket' },
          meta: { requestId: 'req-remote-mapped-loopback' },
        }),
      /only supports HTTP transport/,
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon requires auth for non-loopback remote daemon URLs', async () => {
  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'https://remote-mac.example.test/agent-device';
  delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;

  try {
    await assert.rejects(
      async () =>
        await sendToDaemon({
          session: 'default',
          command: 'remote-smoke',
          positionals: [],
          flags: {},
          meta: { requestId: 'req-remote-auth' },
        }),
      /requires daemon authentication/,
    );
  } finally {
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon uploads local install artifacts for remote daemons and passes upload id to RPC', async () => {
  const seenPaths: string[] = [];
  let uploadBodySize = 0;
  let uploadHeaders: Record<string, unknown> | undefined;
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;

  class MockRequest extends Writable {
    private chunks: Buffer[] = [];
    private readonly options: Record<string, unknown>;
    private readonly callbackFn: (
      res: EventEmitter & {
        statusCode?: number;
        resume?: () => void;
        setEncoding: (_encoding: string) => void;
      },
    ) => void;

    constructor(
      options: Record<string, unknown>,
      callbackFn: (
        res: EventEmitter & {
          statusCode?: number;
          resume?: () => void;
          setEncoding: (_encoding: string) => void;
        },
      ) => void,
    ) {
      super();
      this.options = options;
      this.callbackFn = callbackFn;
    }

    _write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    }

    override end(chunk?: any, encoding?: any, callback?: any): this {
      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = undefined;
      }
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      if (chunk !== undefined) {
        this.write(chunk, encoding);
      }
      super.end(() => {
        seenPaths.push(String(this.options.path ?? ''));
        const res = new EventEmitter() as EventEmitter & {
          statusCode?: number;
          resume?: () => void;
          setEncoding: (_encoding: string) => void;
        };
        res.statusCode = 200;
        res.resume = () => {};
        res.setEncoding = () => {};
        process.nextTick(() => {
          this.callbackFn(res);
          if (this.options.method === 'GET') {
            res.emit('end');
            callback?.();
            return;
          }

          const body = Buffer.concat(this.chunks).toString('utf8');
          if (String(this.options.path).endsWith('/upload')) {
            uploadHeaders = this.options.headers as Record<string, unknown>;
            uploadBodySize = Buffer.concat(this.chunks).byteLength;
            res.emit('data', JSON.stringify({ ok: true, uploadId: 'upload-123' }));
            res.emit('end');
            callback?.();
            return;
          }

          rpcRequest = JSON.parse(body) as Record<string, unknown>;
          res.emit(
            'data',
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'req-remote-upload',
              result: {
                ok: true,
                data: { source: 'remote-daemon' },
              },
            }),
          );
          res.emit('end');
          callback?.();
        });
      });
      return this;
    }

    override destroy(error?: Error): this {
      super.destroy(error);
      return this;
    }
  }

  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: any,
  ) => {
    return new MockRequest(options, callback) as any;
  }) as typeof http.request;

  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-upload-'));
  const appPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(appPath, 'apk-binary');
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://remote-mac.example.test:7777/agent-device';
  process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'remote-secret';

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'install',
      positionals: ['com.example.app', appPath],
      flags: {},
      meta: { requestId: 'req-remote-upload' },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(seenPaths, [
      '/agent-device/health',
      '/agent-device/upload',
      '/agent-device/rpc',
    ]);
    assert.equal(uploadHeaders?.authorization, 'Bearer remote-secret');
    assert.equal(uploadHeaders?.['x-agent-device-token'], 'remote-secret');
    assert.equal(uploadHeaders?.['x-artifact-type'], 'file');
    assert.equal(uploadHeaders?.['x-artifact-filename'], 'Sample.apk');
    assert.ok(uploadBodySize > 0);
    assert.equal((rpcRequest as any)?.params?.positionals?.[1], appPath);
    assert.equal((rpcRequest as any)?.params?.meta?.uploadedArtifactId, 'upload-123');
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon preserves explicit remote install paths without uploading', async () => {
  const seenPaths: string[] = [];
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;
  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: (res: any) => void,
  ) => {
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
        if (options.method === 'GET') {
          res.emit('end');
          return;
        }
        rpcRequest = JSON.parse(body) as Record<string, unknown>;
        res.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-remote-path',
            result: {
              ok: true,
              data: { source: 'remote-daemon' },
            },
          }),
        );
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
      command: 'install',
      positionals: ['com.example.app', 'remote:/srv/builds/Sample.apk'],
      flags: {},
      meta: { requestId: 'req-remote-path' },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(seenPaths, ['/agent-device/health', '/agent-device/rpc']);
    assert.equal((rpcRequest as any)?.params?.positionals?.[1], '/srv/builds/Sample.apk');
    assert.equal((rpcRequest as any)?.params?.meta?.uploadedArtifactId, undefined);
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon preserves install_source payload metadata for remote HTTP RPC', async () => {
  const seenPaths: string[] = [];
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;
  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: (res: any) => void,
  ) => {
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
        if (options.method === 'GET') {
          res.emit('end');
          return;
        }
        rpcRequest = JSON.parse(body) as Record<string, unknown>;
        res.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-install-source',
            result: {
              ok: true,
              data: { source: 'remote-daemon' },
            },
          }),
        );
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
      command: 'install_source',
      positionals: [],
      flags: { platform: 'android' },
      meta: {
        requestId: 'req-install-source',
        installSource: {
          kind: 'url',
          url: 'https://example.com/app.apk',
          headers: {},
        },
        retainMaterializedPaths: true,
        materializedPathRetentionMs: 60_000,
      },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(seenPaths, ['/agent-device/health', '/agent-device/rpc']);
    assert.deepEqual((rpcRequest as any)?.params?.meta?.installSource, {
      kind: 'url',
      url: 'https://example.com/app.apk',
      headers: {},
    });
    assert.equal((rpcRequest as any)?.params?.meta?.retainMaterializedPaths, true);
    assert.equal((rpcRequest as any)?.params?.meta?.materializedPathRetentionMs, 60_000);

    seenPaths.length = 0;
    rpcRequest = null;

    const githubArtifactResponse = await sendToDaemon({
      session: 'default',
      command: 'install_source',
      positionals: [],
      flags: { platform: 'android' },
      meta: {
        requestId: 'req-install-source-gh',
        installSource: {
          kind: 'github-actions-artifact',
          owner: 'acme',
          repo: 'mobile',
          runId: 1234567890,
          artifactName: 'app-debug',
        },
      },
    });

    assert.equal(githubArtifactResponse.ok, true);
    assert.deepEqual(seenPaths, ['/agent-device/health', '/agent-device/rpc']);
    assert.deepEqual((rpcRequest as any)?.params?.meta?.installSource, {
      kind: 'github-actions-artifact',
      owner: 'acme',
      repo: 'mobile',
      runId: 1234567890,
      artifactName: 'app-debug',
    });
    assert.equal((rpcRequest as any)?.params?.meta?.uploadedArtifactId, undefined);
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon uploads local install_source path artifacts for remote daemons', async () => {
  const seenPaths: string[] = [];
  let uploadBodySize = 0;
  let uploadHeaders: Record<string, unknown> | undefined;
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;

  class MockRequest extends Writable {
    private chunks: Buffer[] = [];
    private readonly options: Record<string, unknown>;
    private readonly callbackFn: (
      res: PassThrough & {
        statusCode?: number;
        resume?: () => void;
        setEncoding: (_encoding: string) => void;
      },
    ) => void;

    constructor(
      options: Record<string, unknown>,
      callbackFn: (
        res: PassThrough & {
          statusCode?: number;
          resume?: () => void;
          setEncoding: (_encoding: string) => void;
        },
      ) => void,
    ) {
      super();
      this.options = options;
      this.callbackFn = callbackFn;
    }

    _write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    }

    override end(chunk?: any, encoding?: any, callback?: any): this {
      if (chunk) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        this.chunks.push(buffer);
      }
      const res = new PassThrough() as PassThrough & {
        statusCode?: number;
        resume?: () => void;
        setEncoding: (_encoding: string) => void;
      };
      res.statusCode = 200;
      res.resume = () => res as any;
      res.setEncoding = () => res as any;
      process.nextTick(() => {
        this.callbackFn(res);
        seenPaths.push(String(this.options.path ?? ''));
        if (this.options.method === 'GET') {
          res.emit('end');
          callback?.();
          return;
        }
        const body = Buffer.concat(this.chunks).toString('utf8');
        if (String(this.options.path).endsWith('/upload')) {
          uploadHeaders = this.options.headers as Record<string, unknown>;
          uploadBodySize = Buffer.concat(this.chunks).byteLength;
          res.emit('data', JSON.stringify({ ok: true, uploadId: 'upload-path-123' }));
          res.emit('end');
          callback?.();
          return;
        }

        rpcRequest = JSON.parse(body) as Record<string, unknown>;
        res.emit(
          'data',
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-install-source-path',
            result: {
              ok: true,
              data: { source: 'remote-daemon' },
            },
          }),
        );
        res.emit('end');
        callback?.();
      });
      return this;
    }

    override destroy(error?: Error): this {
      super.destroy(error);
      return this;
    }
  }

  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: any,
  ) => {
    return new MockRequest(options, callback) as any;
  }) as typeof http.request;

  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-install-source-path-'));
  const appPath = path.join(tempRoot, 'Sample.apk');
  fs.writeFileSync(appPath, 'apk-binary');
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://remote-mac.example.test:7777/agent-device';
  process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'remote-secret';

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'install_source',
      positionals: [],
      flags: { platform: 'android' },
      meta: {
        requestId: 'req-install-source-path',
        installSource: {
          kind: 'path',
          path: appPath,
        },
      },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(seenPaths, [
      '/agent-device/health',
      '/agent-device/upload',
      '/agent-device/rpc',
    ]);
    assert.equal(uploadHeaders?.authorization, 'Bearer remote-secret');
    assert.equal(uploadHeaders?.['x-agent-device-token'], 'remote-secret');
    assert.equal(uploadHeaders?.['x-artifact-type'], 'file');
    assert.equal(uploadHeaders?.['x-artifact-filename'], 'Sample.apk');
    assert.ok(uploadBodySize > 0);
    assert.equal((rpcRequest as any)?.params?.meta?.uploadedArtifactId, 'upload-path-123');
    assert.deepEqual((rpcRequest as any)?.params?.meta?.installSource, {
      kind: 'path',
      path: appPath,
    });
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('sendToDaemon downloads remote artifacts and rewrites local paths', async () => {
  const seenPaths: string[] = [];
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;

  class MockRequest extends Writable {
    private chunks: Buffer[] = [];
    private readonly options: Record<string, unknown>;
    private readonly callbackFn: (
      res: PassThrough & {
        statusCode?: number;
        resume?: () => void;
        setEncoding: (_encoding: string) => void;
      },
    ) => void;
    constructor(
      options: Record<string, unknown>,
      callbackFn: (
        res: PassThrough & {
          statusCode?: number;
          resume?: () => void;
          setEncoding: (_encoding: string) => void;
        },
      ) => void,
    ) {
      super();
      this.options = options;
      this.callbackFn = callbackFn;
    }

    _write(
      chunk: Buffer | string,
      _encoding: BufferEncoding,
      callback: (error?: Error | null) => void,
    ): void {
      this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    }

    override end(chunk?: any, encoding?: any, callback?: any): this {
      if (typeof chunk === 'function') {
        callback = chunk;
        chunk = undefined;
      }
      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }
      if (chunk !== undefined) {
        this.write(chunk, encoding);
      }
      super.end(() => {
        seenPaths.push(String(this.options.path ?? ''));
        const res = new PassThrough() as PassThrough & {
          statusCode?: number;
          resume?: () => void;
          setEncoding: (_encoding: string) => void;
        };
        res.statusCode = 200;
        process.nextTick(() => {
          this.callbackFn(res);
          if (this.options.method === 'GET' && String(this.options.path).endsWith('/health')) {
            res.end();
            callback?.();
            return;
          }
          if (this.options.method === 'GET' && String(this.options.path).includes('/artifacts/')) {
            res.end(Buffer.from('png-binary'));
            callback?.();
            return;
          }
          rpcRequest = JSON.parse(Buffer.concat(this.chunks).toString('utf8')) as Record<
            string,
            unknown
          >;
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'req-remote-artifact',
              result: {
                ok: true,
                data: {
                  path: '/tmp/remote-screenshot.png',
                  artifacts: [
                    {
                      field: 'path',
                      artifactId: 'artifact-123',
                      fileName: 'screen.png',
                      localPath: path.join(tempRoot, 'artifacts', 'screen.png'),
                    },
                  ],
                },
              },
            }),
          );
          callback?.();
        });
      });
      return this;
    }

    override destroy(error?: Error): this {
      super.destroy(error);
      return this;
    }
  }

  (http as unknown as { request: typeof http.request }).request = ((
    options: any,
    callback: any,
  ) => {
    return new MockRequest(options, callback) as any;
  }) as typeof http.request;

  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-artifact-'));
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://remote-mac.example.test:7777/agent-device';
  process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = 'remote-secret';

  try {
    const response = await sendToDaemon({
      session: 'default',
      command: 'screenshot',
      positionals: ['artifacts/screen.png'],
      flags: {},
      meta: {
        requestId: 'req-remote-artifact',
        cwd: tempRoot,
      },
    });

    assert.equal(response.ok, true);
    assert.deepEqual(seenPaths, [
      '/agent-device/health',
      '/agent-device/rpc',
      '/agent-device/artifacts/artifact-123',
    ]);
    assert.match(
      String((rpcRequest as any)?.params?.positionals?.[0]),
      /^\/tmp\/agent-device-screenshot-/,
    );
    assert.equal(
      (rpcRequest as any)?.params?.meta?.clientArtifactPaths?.path,
      path.join(tempRoot, 'artifacts', 'screen.png'),
    );
    assert.equal(
      (response as Extract<typeof response, { ok: true }>).data?.path,
      path.join(tempRoot, 'artifacts', 'screen.png'),
    );
    assert.equal(
      fs.readFileSync(path.join(tempRoot, 'artifacts', 'screen.png'), 'utf8'),
      'png-binary',
    );
  } finally {
    (http as unknown as { request: typeof http.request }).request = originalHttpRequest;
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (previousBaseUrl === undefined) delete process.env.AGENT_DEVICE_DAEMON_BASE_URL;
    else process.env.AGENT_DEVICE_DAEMON_BASE_URL = previousBaseUrl;
    if (previousAuthToken === undefined) delete process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
    else process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = previousAuthToken;
  }
});

test('downloadRemoteArtifact times out stalled artifact responses and removes partial files', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-remote-artifact-timeout-'));
  const destinationPath = path.join(tempRoot, 'artifacts', 'screen.png');
  const server = http.createServer((req, _res) => {
    if (req.url?.includes('/artifacts/')) {
      return;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await assert.rejects(
      async () =>
        await downloadRemoteArtifact({
          baseUrl: `http://127.0.0.1:${port}/agent-device`,
          token: 'remote-secret',
          artifactId: 'artifact-timeout',
          destinationPath,
          requestId: 'req-remote-artifact-timeout',
          timeoutMs: 50,
        }),
      (error: unknown) => {
        assert.equal(error instanceof Error, true);
        assert.match(String((error as Error).message), /timed out/i);
        return true;
      },
    );
    assert.equal(fs.existsSync(destinationPath), false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('computeDaemonCodeSignature fingerprints the daemon runtime import graph', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-daemon-signature-'));
  try {
    const daemonEntryPath = path.join(root, 'src', 'daemon.ts');
    const helperPath = path.join(root, 'src', 'helper.ts');
    const lazyPath = path.join(root, 'src', 'lazy.ts');
    const ignoredPath = path.join(root, 'src', 'ignored.ts');
    fs.mkdirSync(path.dirname(daemonEntryPath), { recursive: true });
    fs.writeFileSync(
      daemonEntryPath,
      [
        "import './helper.ts';",
        'export async function boot() {',
        "  return await import('./lazy.ts');",
        '}',
        '',
      ].join('\n'),
      'utf8',
    );
    fs.writeFileSync(helperPath, 'export const helper = 1;\n', 'utf8');
    fs.writeFileSync(lazyPath, 'export const lazy = 1;\n', 'utf8');
    fs.writeFileSync(ignoredPath, 'export const ignored = 1;\n', 'utf8');

    const initial = computeDaemonCodeSignature(daemonEntryPath, root);
    assert.match(initial, /^graph:3:[0-9a-f]{40}$/);

    fs.writeFileSync(lazyPath, 'export const lazy = 200;\n', 'utf8');
    const changedRuntime = computeDaemonCodeSignature(daemonEntryPath, root);
    assert.notEqual(changedRuntime, initial);

    fs.writeFileSync(ignoredPath, 'export const ignored = 200;\n', 'utf8');
    const changedUnrelated = computeDaemonCodeSignature(daemonEntryPath, root);
    assert.equal(changedUnrelated, changedRuntime);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stopDaemonProcessForTakeover terminates a matching daemon process', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-daemon-test-'));
  const daemonDir = path.join(root, 'agent-device', 'dist', 'src', 'internal');
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
