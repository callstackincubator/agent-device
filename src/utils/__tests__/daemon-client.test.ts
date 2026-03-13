import test from 'node:test';
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

test('openApp forwards typed runtime hints on open requests', async () => {
  let rpcRequest: Record<string, unknown> | null = null;
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
        res.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-open-app',
          result: {
            ok: true,
            data: { launched: true },
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

test('sendToDaemon uploads local install artifacts for remote daemons and passes upload id to RPC', async () => {
  const seenPaths: string[] = [];
  let uploadBodySize = 0;
  let uploadHeaders: Record<string, unknown> | undefined;
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;

  class MockRequest extends Writable {
    private chunks: Buffer[] = [];
    private readonly options: Record<string, unknown>;
    private readonly callbackFn: (res: EventEmitter & {
      statusCode?: number;
      resume?: () => void;
      setEncoding: (_encoding: string) => void;
    }) => void;

    constructor(
      options: Record<string, unknown>,
      callbackFn: (res: EventEmitter & {
        statusCode?: number;
        resume?: () => void;
        setEncoding: (_encoding: string) => void;
      }) => void,
    ) {
      super();
      this.options = options;
      this.callbackFn = callbackFn;
    }

    _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
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
          res.emit('data', JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-remote-upload',
            result: {
              ok: true,
              data: { source: 'remote-daemon' },
            },
          }));
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

  (http as unknown as { request: typeof http.request }).request = ((options: any, callback: any) => {
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
    assert.deepEqual(seenPaths, ['/agent-device/health', '/agent-device/upload', '/agent-device/rpc']);
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
        res.emit('data', JSON.stringify({
          jsonrpc: '2.0',
          id: 'req-remote-path',
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
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = 'http://remote-mac.example.test:7777/agent-device';

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
  }
});

test('sendToDaemon downloads remote artifacts and rewrites local paths', async () => {
  const seenPaths: string[] = [];
  let rpcRequest: Record<string, unknown> | null = null;
  const originalHttpRequest = http.request;

  class MockRequest extends Writable {
    private chunks: Buffer[] = [];
    private readonly options: Record<string, unknown>;
    private readonly callbackFn: (res: PassThrough & {
      statusCode?: number;
      resume?: () => void;
      setEncoding: (_encoding: string) => void;
    }) => void;
    private activeResponse?: PassThrough & {
      statusCode?: number;
      resume?: () => void;
      setEncoding: (_encoding: string) => void;
    };

    constructor(
      options: Record<string, unknown>,
      callbackFn: (res: PassThrough & {
        statusCode?: number;
        resume?: () => void;
        setEncoding: (_encoding: string) => void;
      }) => void,
    ) {
      super();
      this.options = options;
      this.callbackFn = callbackFn;
    }

    _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
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
        this.activeResponse = res;
        res.statusCode = 200;
        process.nextTick(() => {
          this.callbackFn(res);
          if (this.options.method === 'GET' && String(this.options.path).endsWith('/health')) {
            res.end();
            callback?.();
            return;
          }
          if (this.options.method === 'GET' && String(this.options.path).includes('/upload/')) {
            res.end(Buffer.from('png-binary'));
            callback?.();
            return;
          }
          rpcRequest = JSON.parse(Buffer.concat(this.chunks).toString('utf8')) as Record<string, unknown>;
          res.end(JSON.stringify({
            jsonrpc: '2.0',
            id: 'req-remote-artifact',
            result: {
              ok: true,
              data: {
                path: '/tmp/remote-screenshot.png',
                artifacts: [{
                  field: 'path',
                  artifactId: 'artifact-123',
                  fileName: 'screen.png',
                  localPath: path.join(tempRoot, 'artifacts', 'screen.png'),
                }],
              },
            },
          }));
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

  (http as unknown as { request: typeof http.request }).request = ((options: any, callback: any) => {
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
    assert.deepEqual(seenPaths, ['/agent-device/health', '/agent-device/rpc', '/agent-device/upload/artifact-123']);
    assert.match(String((rpcRequest as any)?.params?.positionals?.[0]), /^\/tmp\/agent-device-screenshot-/);
    assert.equal(
      (rpcRequest as any)?.params?.meta?.clientArtifactPaths?.path,
      path.join(tempRoot, 'artifacts', 'screen.png'),
    );
    assert.equal((response as Extract<typeof response, { ok: true }>).data?.path, path.join(tempRoot, 'artifacts', 'screen.png'));
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
    if (req.url?.includes('/upload/')) {
      return;
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const port = typeof address === 'object' && address ? address.port : 0;

  try {
    await assert.rejects(
      async () => await downloadRemoteArtifact({
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
