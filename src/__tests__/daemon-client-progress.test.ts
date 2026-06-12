import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { test } from 'vitest';
import type { DaemonRequest, DaemonResponse } from '../daemon/types.ts';
import { readDaemonSocketProgressResponse } from '../daemon-client-progress.ts';
import { AppError } from '../utils/errors.ts';

type MockSocket = EventEmitter & {
  ended: boolean;
  encoding?: string;
  end: () => MockSocket;
  setEncoding: (encoding: BufferEncoding) => MockSocket;
};

function createMockSocket(): MockSocket {
  const socket = new EventEmitter() as MockSocket;
  socket.ended = false;
  socket.end = () => {
    socket.ended = true;
    socket.emit('close');
    return socket;
  };
  socket.setEncoding = (encoding) => {
    socket.encoding = encoding;
    return socket;
  };
  return socket;
}

function readSocketProgressResponse(
  socket: MockSocket,
  req: DaemonRequest,
): Promise<DaemonResponse> {
  let settled = false;
  return new Promise((resolve, reject) => {
    readDaemonSocketProgressResponse(socket as unknown as Socket, {
      req,
      isSettled: () => settled,
      clearTimeout: () => {},
      resolve: (response) => {
        settled = true;
        resolve(response);
      },
      reject: (error) => {
        settled = true;
        reject(error);
      },
    });
  });
}

test('readDaemonSocketProgressResponse parses split progress lines before response envelopes', async () => {
  const socket = createMockSocket();
  const req: DaemonRequest = {
    session: 'default',
    command: 'test',
    positionals: ['/tmp/replays'],
    flags: {},
    token: 'secret',
    meta: { requestId: 'req-socket-progress', requestProgress: 'replay-test' },
  };
  let stderr = '';
  const originalStderrWrite = process.stderr.write.bind(process.stderr);

  try {
    (process.stderr as any).write = ((chunk: unknown) => {
      stderr += String(chunk);
      return true;
    }) as typeof process.stderr.write;

    const responsePromise = readSocketProgressResponse(socket, req);
    const progressLine = JSON.stringify({
      type: 'progress',
      event: {
        type: 'replay-test',
        file: '/tmp/01-login.ad',
        title: 'Login flow',
        status: 'fail',
        index: 1,
        total: 2,
        attempt: 1,
        maxAttempts: 2,
        durationMs: 1234,
        retrying: true,
        message: 'first attempt failed',
      },
    });
    const responseLine = JSON.stringify({
      type: 'response',
      response: { ok: true, data: { via: 'socket-progress' } },
    });

    socket.emit('data', progressLine.slice(0, 24));
    socket.emit('data', `${progressLine.slice(24)}\n${responseLine}\n`);
    socket.emit('data', '{not-json-after-settle}\n');

    await assert.doesNotReject(responsePromise);
    assert.deepEqual(await responsePromise, { ok: true, data: { via: 'socket-progress' } });
    assert.equal(socket.encoding, 'utf8');
    assert.equal(socket.ended, true);
    assert.match(stderr, /\[1\/2] RETRY "Login flow" in 01-login\.ad attempt 1\/2 \(1\.23s\)/);
    assert.match(stderr, /  first attempt failed/);
  } finally {
    process.stderr.write = originalStderrWrite;
  }
});

test('readDaemonSocketProgressResponse rejects invalid response lines with request context', async () => {
  const socket = createMockSocket();
  const req: DaemonRequest = {
    session: 'default',
    command: 'snapshot',
    positionals: [],
    flags: {},
    token: 'secret',
    meta: { requestId: 'req-invalid-socket-progress' },
  };

  const responsePromise = readSocketProgressResponse(socket, req);
  socket.emit('data', '{not-json}\n');

  await assert.rejects(
    responsePromise,
    (error) =>
      error instanceof AppError &&
      error.code === 'COMMAND_FAILED' &&
      error.message === 'Invalid daemon response' &&
      error.details?.requestId === 'req-invalid-socket-progress' &&
      error.details?.line === '{not-json}',
  );
});
