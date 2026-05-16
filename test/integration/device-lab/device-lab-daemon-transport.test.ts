import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { test } from 'vitest';
import type { DaemonRequest, DaemonResponse } from '../../../src/daemon/types.ts';
import {
  createSocketServer,
  listenHttpServer,
  listenNetServer,
} from '../../../src/daemon/transport.ts';
import { supportsLoopbackBind } from './loopback.ts';

test('Device Lab daemon socket transport frames requests and normalizes malformed input', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  const observedRequests: DaemonRequest[] = [];
  const server = createSocketServer(async (req): Promise<DaemonResponse> => {
    observedRequests.push(req);
    return {
      ok: true,
      data: {
        command: req.command,
        requestId: req.meta?.requestId,
      },
    };
  });

  try {
    const port = await listenNetServer(server);
    const client = await connectSocket(port);

    const responses = await writeSocketRequests(client, [
      '',
      JSON.stringify({
        token: 'device-lab-token',
        session: 'default',
        command: 'session_list',
        positionals: [],
        meta: { requestId: 'req-socket-1' },
      }),
      '{not-json}',
    ]);

    assert.equal(observedRequests.length, 1);
    assert.equal(observedRequests[0]?.meta?.requestId, 'req-socket-1');
    assert.deepEqual(responses[0], {
      ok: true,
      data: {
        command: 'session_list',
        requestId: 'req-socket-1',
      },
    });
    assert.equal(responses[1]?.ok, false);
    assert.equal(responses[1]?.error?.code, 'UNKNOWN');

    const clientClosed = new Promise<void>((resolve) => client.once('close', () => resolve()));
    server.destroyConnections?.();
    await clientClosed;
    assert.equal(client.destroyed, true);

    const httpServer = http.createServer((_req, res) => {
      res.end('ok');
    });
    const httpPort = await listenHttpServer(httpServer);
    assert.equal(typeof httpPort, 'number');
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
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
  }
});

async function connectSocket(port: number): Promise<net.Socket> {
  return await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve(socket);
    });
    socket.once('error', reject);
  });
}

async function writeSocketRequests(
  socket: net.Socket,
  lines: string[],
): Promise<Array<{ ok?: boolean; data?: any; error?: any }>> {
  return await new Promise((resolve, reject) => {
    const responses: Array<{ ok?: boolean; data?: any; error?: any }> = [];
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      let idx = buffer.indexOf('\n');
      while (idx !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) {
          responses.push(JSON.parse(line));
        }
        if (responses.length === 2) {
          resolve(responses);
          return;
        }
        idx = buffer.indexOf('\n');
      }
    });
    socket.once('error', reject);
    socket.write(`${lines.join('\n')}\n`);
  });
}
