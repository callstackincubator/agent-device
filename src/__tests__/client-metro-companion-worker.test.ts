import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, test } from 'vitest';
import { buildCompanionPayload } from '../client-metro-companion-worker.ts';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type CloseFrame = {
  code?: number;
  reason?: string;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function waitFor<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error(`Timed out waiting for ${label}.`);
    }),
  ]);
}

function encodeTextFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8');
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  return Buffer.concat([
    Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]),
    payload,
  ]);
}

function encodeCloseFrame(code = 1000, reason = ''): Buffer {
  const reasonBuffer = Buffer.from(reason, 'utf8');
  const payload = Buffer.allocUnsafe(2 + reasonBuffer.length);
  payload.writeUInt16BE(code, 0);
  reasonBuffer.copy(payload, 2);
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x88, payload.length]), payload]);
  }
  return Buffer.concat([
    Buffer.from([0x88, 126, payload.length >> 8, payload.length & 0xff]),
    payload,
  ]);
}

function attachWebSocketFrameParser(
  socket: NodeJS.WritableStream & NodeJS.EventEmitter,
  onText: (text: string) => void,
  onClose?: (frame: CloseFrame) => void,
): void {
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    let offset = 0;
    while (offset + 2 <= pending.length) {
      const first = pending[offset++];
      const second = pending[offset++];
      const opcode = first & 0x0f;
      let length = second & 0x7f;
      if (length === 126) {
        if (offset + 2 > pending.length) {
          offset -= 4;
          break;
        }
        length = pending.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        throw new Error('Large WebSocket frames are not supported in this test.');
      }
      const masked = (second & 0x80) !== 0;
      const maskLength = masked ? 4 : 0;
      if (offset + maskLength + length > pending.length) {
        offset -= length === 126 ? 4 : 2;
        break;
      }
      const mask = masked ? pending.subarray(offset, offset + 4) : null;
      offset += maskLength;
      let payload = pending.subarray(offset, offset + length);
      offset += length;
      if (masked && mask) {
        payload = Buffer.from(payload);
        for (let index = 0; index < payload.length; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      if (opcode === 0x1) {
        onText(payload.toString('utf8'));
        continue;
      }
      if (opcode === 0x8) {
        if (!onClose) continue;
        if (payload.length >= 2) {
          onClose({
            code: payload.readUInt16BE(0),
            reason: payload.subarray(2).toString('utf8'),
          });
        } else {
          onClose({});
        }
      }
    }
    pending = pending.subarray(offset);
  });
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address.');
  }
  return address.port;
}

async function closeServer(server: http.Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function stopChild(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  child.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once('close', () => resolve(true))),
    delay(2_000).then(() => false),
  ]);
  if (exited) return;
  child.kill('SIGKILL');
  await new Promise<void>((resolve) => child.once('close', () => resolve()));
}

const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanupTasks.length > 0) {
    const task = cleanupTasks.pop();
    if (!task) continue;
    await task();
  }
});

test('companion payload includes React DevTools session and device port', () => {
  assert.deepEqual(
    buildCompanionPayload({
      serverBaseUrl: 'https://bridge.example.test',
      bearerToken: 'token',
      localBaseUrl: 'http://127.0.0.1:8097/',
      bridgeScope: {
        tenantId: 'tenant-1',
        runId: 'run-1',
        leaseId: 'lease-1',
      },
      session: 'default',
      devicePort: 8097,
      registerPath: '/api/react-devtools/companion/register',
      unregisterPath: '/api/react-devtools/companion/unregister',
    }),
    {
      tenantId: 'tenant-1',
      runId: 'run-1',
      leaseId: 'lease-1',
      session: 'default',
      local_base_url: 'http://127.0.0.1:8097',
      device_port: 8097,
    },
  );
});

test('metro companion worker proxies websocket frames to the local upstream server', async () => {
  const upstreamMessage = createDeferred<string>();
  const bridgePong = createDeferred<void>();
  const bridgeSocketReady = createDeferred<NodeJS.WritableStream>();
  const registrationBody = createDeferred<Record<string, unknown>>();
  const bridgeOpen = createDeferred<void>();
  const bridgeFrame = createDeferred<string>();
  const bridgeClose = createDeferred<CloseFrame>();
  let upstreamSocketRef: Duplex | null = null;
  let bridgeSocketRef: Duplex | null = null;

  const upstreamServer = http.createServer((_, res) => {
    res.writeHead(404);
    res.end('not found');
  });
  upstreamServer.on('upgrade', (req, socket) => {
    if (req.url !== '/echo') {
      socket.destroy();
      return;
    }
    upstreamSocketRef = socket;
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    attachWebSocketFrameParser(
      socket,
      (text) => {
        upstreamMessage.resolve(text);
        socket.write(encodeTextFrame(text));
      },
      () => {
        socket.write(encodeCloseFrame(1000, 'upstream done'));
        socket.end();
      },
    );
  });
  cleanupTasks.push(() => closeServer(upstreamServer));
  cleanupTasks.push(async () => {
    upstreamSocketRef?.destroy();
  });
  const upstreamPort = await listen(upstreamServer);

  const bridgeServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/api/metro/companion/register') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on('end', () => {
        registrationBody.resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: { ws_url: `ws://127.0.0.1:${bridgePort}/bridge` },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  bridgeServer.on('upgrade', (req, socket) => {
    if (req.url !== '/bridge') {
      socket.destroy();
      return;
    }
    bridgeSocketRef = socket;
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    bridgeSocketReady.resolve(socket);

    attachWebSocketFrameParser(socket, (text) => {
      const message = JSON.parse(text) as
        | { type: 'pong'; timestamp: number }
        | { type: 'ws-open-result'; streamId: string; success: boolean }
        | { type: 'ws-frame'; streamId: string; dataBase64: string }
        | { type: 'ws-close'; streamId: string; code?: number; reason?: string };
      if (message.type === 'pong') {
        bridgePong.resolve();
        return;
      }
      if (message.type === 'ws-open-result' && message.success) {
        bridgeOpen.resolve();
        return;
      }
      if (message.type === 'ws-frame') {
        bridgeFrame.resolve(Buffer.from(message.dataBase64, 'base64').toString('utf8'));
        return;
      }
      if (message.type === 'ws-close') {
        bridgeClose.resolve({ code: message.code, reason: message.reason });
      }
    });

    socket.write(encodeTextFrame(JSON.stringify({ type: 'ping', timestamp: Date.now() })));
    socket.write(
      encodeTextFrame(
        JSON.stringify({
          type: 'ws-open',
          streamId: 'stream-1',
          path: '/echo',
          headers: {},
        }),
      ),
    );
  });
  cleanupTasks.push(() => closeServer(bridgeServer));
  cleanupTasks.push(async () => {
    bridgeSocketRef?.destroy();
  });
  const bridgePort = await listen(bridgeServer);

  const companion = spawn(
    process.execPath,
    ['--experimental-strip-types', 'src/metro-companion.ts', '--agent-device-run-metro-companion'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL: `http://127.0.0.1:${bridgePort}`,
        AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN: 'test-token',
        AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
        AGENT_DEVICE_METRO_COMPANION_SCOPE_TENANT_ID: 'tenant-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_RUN_ID: 'run-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_LEASE_ID: 'lease-1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  companion.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  cleanupTasks.push(() => stopChild(companion));

  const earlyExit = new Promise<never>((_, reject) => {
    companion.once('exit', (code, signal) => {
      reject(
        new Error(
          `Metro companion exited unexpectedly with code=${String(code)} signal=${String(signal)} stderr=${stderr}`,
        ),
      );
    });
  });

  const bridgeSocket = await Promise.race([
    waitFor(bridgeSocketReady.promise, 5_000, 'bridge websocket connection'),
    earlyExit,
  ]);
  assert.deepEqual(await waitFor(registrationBody.promise, 5_000, 'companion registration'), {
    tenantId: 'tenant-1',
    runId: 'run-1',
    leaseId: 'lease-1',
    local_base_url: `http://127.0.0.1:${upstreamPort}`,
  });
  await Promise.race([waitFor(bridgePong.promise, 5_000, 'bridge pong'), earlyExit]);
  await Promise.race([waitFor(bridgeOpen.promise, 5_000, 'bridge ws-open-result'), earlyExit]);
  bridgeSocket.write(
    encodeTextFrame(
      JSON.stringify({
        type: 'ws-frame',
        streamId: 'stream-1',
        dataBase64: Buffer.from('hello websocket', 'utf8').toString('base64'),
        binary: false,
      }),
    ),
  );
  await Promise.race([waitFor(upstreamMessage.promise, 5_000, 'upstream message'), earlyExit]);
  const echoedMessage = await Promise.race([
    waitFor(bridgeFrame.promise, 5_000, 'bridge echoed frame'),
    earlyExit,
  ]);
  bridgeSocket.write(
    encodeTextFrame(
      JSON.stringify({
        type: 'ws-close',
        streamId: 'stream-1',
        code: 1000,
        reason: 'bridge done',
      }),
    ),
  );
  const closeFrame = await Promise.race([
    waitFor(bridgeClose.promise, 5_000, 'bridge close frame'),
    earlyExit,
  ]);

  assert.equal(echoedMessage, 'hello websocket');
  assert.equal(closeFrame.code, 1000);
});

test('metro companion worker reconnects after the bridge closes immediately after open', async () => {
  const bridgeReconnect = createDeferred<void>();
  let bridgeConnections = 0;
  let bridgePort = 0;
  let bridgeSocketRef: Duplex | null = null;

  const localServer = http.createServer((_, res) => {
    res.writeHead(404);
    res.end('not found');
  });
  cleanupTasks.push(() => closeServer(localServer));
  const localPort = await listen(localServer);

  const bridgeServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/api/metro/companion/register') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: { ws_url: `ws://127.0.0.1:${bridgePort}/bridge` },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  bridgeServer.on('upgrade', (req, socket) => {
    if (req.url !== '/bridge') {
      socket.destroy();
      return;
    }
    socket.on('error', () => {
      // The first bridge socket is expected to drop immediately to exercise reconnect handling.
    });
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    bridgeSocketRef = socket;
    bridgeConnections += 1;
    if (bridgeConnections === 1) {
      socket.end();
      return;
    }
    bridgeReconnect.resolve();
  });
  cleanupTasks.push(() => closeServer(bridgeServer));
  cleanupTasks.push(async () => {
    bridgeSocketRef?.destroy();
  });
  const listenedBridgePort = await listen(bridgeServer);
  bridgePort = listenedBridgePort;

  const companion = spawn(
    process.execPath,
    ['--experimental-strip-types', 'src/metro-companion.ts', '--agent-device-run-metro-companion'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL: `http://127.0.0.1:${bridgePort}`,
        AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN: 'test-token',
        AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL: `http://127.0.0.1:${localPort}`,
        AGENT_DEVICE_METRO_COMPANION_SCOPE_TENANT_ID: 'tenant-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_RUN_ID: 'run-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_LEASE_ID: 'lease-1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stderr = '';
  companion.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  cleanupTasks.push(() => stopChild(companion));

  const earlyExit = new Promise<never>((_, reject) => {
    companion.once('exit', (code, signal) => {
      reject(
        new Error(
          `Metro companion exited unexpectedly with code=${String(code)} signal=${String(signal)} stderr=${stderr}`,
        ),
      );
    });
  });

  await Promise.race([waitFor(bridgeReconnect.promise, 5_000, 'bridge reconnect'), earlyExit]);

  assert.equal(bridgeConnections, 2);
});

test('metro companion worker exits after its state file is removed', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-metro-companion-worker-'));
  const statePath = path.join(tempRoot, 'metro-companion.json');
  fs.writeFileSync(statePath, '{}', 'utf8');
  cleanupTasks.push(async () => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const bridgeSocketReady = createDeferred<void>();
  let bridgePort = 0;
  let bridgeSocketRef: Duplex | null = null;

  const localServer = http.createServer((_, res) => {
    res.writeHead(404);
    res.end('not found');
  });
  cleanupTasks.push(() => closeServer(localServer));
  const localPort = await listen(localServer);

  const bridgeServer = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/api/metro/companion/register') {
      req.resume();
      req.on('end', () => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            data: { ws_url: `ws://127.0.0.1:${bridgePort}/bridge` },
          }),
        );
      });
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  bridgeServer.on('upgrade', (req, socket) => {
    if (req.url !== '/bridge') {
      socket.destroy();
      return;
    }
    bridgeSocketRef = socket;
    const key = req.headers['sec-websocket-key'];
    if (typeof key !== 'string') {
      socket.destroy();
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    bridgeSocketReady.resolve();
  });
  cleanupTasks.push(() => closeServer(bridgeServer));
  cleanupTasks.push(async () => {
    bridgeSocketRef?.destroy();
  });
  bridgePort = await listen(bridgeServer);

  const companion = spawn(
    process.execPath,
    ['--experimental-strip-types', 'src/metro-companion.ts', '--agent-device-run-metro-companion'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL: `http://127.0.0.1:${bridgePort}`,
        AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN: 'test-token',
        AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL: `http://127.0.0.1:${localPort}`,
        AGENT_DEVICE_METRO_COMPANION_SCOPE_TENANT_ID: 'tenant-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_RUN_ID: 'run-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_LEASE_ID: 'lease-1',
        AGENT_DEVICE_METRO_COMPANION_STATE_PATH: statePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  cleanupTasks.push(() => stopChild(companion));

  let stderr = '';
  companion.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  await waitFor(bridgeSocketReady.promise, 5_000, 'bridge websocket connection');
  fs.unlinkSync(statePath);

  const exit = await waitFor(
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      companion.once('exit', (code, signal) => resolve({ code, signal }));
    }),
    5_000,
    'worker exit after state cleanup',
  );

  assert.equal(exit.signal, null, `unexpected worker stderr: ${stderr}`);
  assert.equal(exit.code, 0, `unexpected worker stderr: ${stderr}`);
});

test('metro companion worker exits immediately when its state file is already missing', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-metro-companion-worker-'));
  const statePath = path.join(tempRoot, 'missing-metro-companion.json');
  cleanupTasks.push(async () => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  const companion = spawn(
    process.execPath,
    ['--experimental-strip-types', 'src/metro-companion.ts', '--agent-device-run-metro-companion'],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_DEVICE_METRO_COMPANION_SERVER_BASE_URL: 'http://127.0.0.1:1',
        AGENT_DEVICE_METRO_COMPANION_BEARER_TOKEN: 'test-token',
        AGENT_DEVICE_METRO_COMPANION_LOCAL_BASE_URL: 'http://127.0.0.1:1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_TENANT_ID: 'tenant-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_RUN_ID: 'run-1',
        AGENT_DEVICE_METRO_COMPANION_SCOPE_LEASE_ID: 'lease-1',
        AGENT_DEVICE_METRO_COMPANION_STATE_PATH: statePath,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  cleanupTasks.push(() => stopChild(companion));

  let stderr = '';
  companion.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const exit = await waitFor(
    new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      companion.once('exit', (code, signal) => resolve({ code, signal }));
    }),
    5_000,
    'worker exit with missing state file',
  );

  assert.equal(exit.signal, null, `unexpected worker stderr: ${stderr}`);
  assert.equal(exit.code, 0, `unexpected worker stderr: ${stderr}`);
});
