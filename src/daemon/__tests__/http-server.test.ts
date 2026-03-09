import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createDaemonHttpServer } from '../http-server.ts';
import { isRequestCanceled } from '../request-cancel.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';

let loopbackBindSupportPromise: Promise<boolean> | null = null;

async function supportsLoopbackBind(): Promise<boolean> {
  if (loopbackBindSupportPromise) {
    return await loopbackBindSupportPromise;
  }
  loopbackBindSupportPromise = new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.listen(0, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
  return await loopbackBindSupportPromise;
}

async function listen(server: http.Server): Promise<number> {
  return await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
        return;
      }
      reject(new Error('Failed to bind test server'));
    });
  });
}

async function callRpc(port: number, payload: Record<string, unknown>): Promise<{ statusCode: number; json: unknown }> {
  const body = JSON.stringify(payload);
  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () => {
          try {
            resolve({
              statusCode: response.statusCode ?? 0,
              json: JSON.parse(responseBody),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

test('HTTP RPC does not cancel active requests after the request body completes', async (t) => {
  if (!(await supportsLoopbackBind())) {
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }

  let observedCanceled: boolean | undefined;
  const server = await createDaemonHttpServer({
    handleRequest: async (req: DaemonRequest): Promise<DaemonResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      observedCanceled = isRequestCanceled(req.meta?.requestId);
      return { ok: true, data: { requestId: req.meta?.requestId } };
    },
  });
  const port = await listen(server);
  t.after(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  const response = await callRpc(port, {
    jsonrpc: '2.0',
    id: 'rpc-keepalive',
    method: 'agent_device.command',
    params: {
      token: 'test-token',
      session: 'default',
      command: 'session_list',
      positionals: [],
      meta: {
        requestId: 'rpc-keepalive',
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.json as { result?: { ok?: boolean } }).result?.ok, true);
  assert.equal(observedCanceled, false);
});
