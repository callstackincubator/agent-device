import { test, onTestFinished } from 'vitest';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDaemonHttpServer } from '../http-server.ts';
import { trackDownloadableArtifact } from '../artifact-tracking.ts';
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

async function callRpc(
  port: number,
  payload: Record<string, unknown>,
): Promise<{ statusCode: number; json: unknown }> {
  const body = JSON.stringify(payload);
  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        agent: false,
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          connection: 'close',
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

async function callGet(
  port: number,
  requestPath: string,
  headers?: http.OutgoingHttpHeaders,
): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
  return await new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: requestPath,
        method: 'GET',
        agent: false,
        headers,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body,
            headers: response.headers,
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

test('HTTP RPC does not cancel active requests after the request body completes', async (ctx) => {
  if (!(await supportsLoopbackBind())) {
    ctx.skip();
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
  onTestFinished(async () => {
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

test('HTTP install_from_source RPC maps typed params to an install_source daemon request', async (ctx) => {
  if (!(await supportsLoopbackBind())) {
    ctx.skip();
    return;
  }

  let observedRequest: DaemonRequest | undefined;
  const server = await createDaemonHttpServer({
    handleRequest: async (req: DaemonRequest): Promise<DaemonResponse> => {
      observedRequest = req;
      return { ok: true, data: { launchTarget: 'com.example.archive' } };
    },
    token: 'test-token',
  });
  const port = await listen(server);
  onTestFinished(async () => {
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
    id: 'rpc-install-source',
    method: 'agent_device.install_from_source',
    params: {
      token: 'test-token',
      session: 'bootstrap',
      platform: 'android',
      requestId: 'req-install-source',
      retainPaths: true,
      retentionMs: 30000,
      source: {
        kind: 'url',
        url: 'https://example.com/app.zip',
        headers: {
          authorization: 'Bearer signed-token',
        },
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.json as { result?: { ok?: boolean } }).result?.ok, true);
  assert.equal(observedRequest?.command, 'install_source');
  assert.equal(observedRequest?.session, 'bootstrap');
  assert.equal(observedRequest?.flags?.platform, 'android');
  assert.equal(observedRequest?.meta?.requestId, 'req-install-source');
  assert.equal(observedRequest?.meta?.retainMaterializedPaths, true);
  assert.equal(observedRequest?.meta?.materializedPathRetentionMs, 30000);
  assert.deepEqual(observedRequest?.meta?.installSource, {
    kind: 'url',
    url: 'https://example.com/app.zip',
    headers: {
      authorization: 'Bearer signed-token',
    },
  });
});

test('HTTP release_materialized_paths RPC maps typed params to a release_materialized_paths daemon request', async (ctx) => {
  if (!(await supportsLoopbackBind())) {
    ctx.skip();
    return;
  }

  let observedRequest: DaemonRequest | undefined;
  const server = await createDaemonHttpServer({
    handleRequest: async (req: DaemonRequest): Promise<DaemonResponse> => {
      observedRequest = req;
      return { ok: true, data: { released: true } };
    },
    token: 'test-token',
  });
  const port = await listen(server);
  onTestFinished(async () => {
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
    id: 'rpc-release-materialized',
    method: 'agent_device.release_materialized_paths',
    params: {
      token: 'test-token',
      session: 'bootstrap',
      requestId: 'req-release-materialized',
      materializationId: 'materialized-123',
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal((response.json as { result?: { ok?: boolean } }).result?.ok, true);
  assert.equal(observedRequest?.command, 'release_materialized_paths');
  assert.equal(observedRequest?.session, 'bootstrap');
  assert.equal(observedRequest?.meta?.requestId, 'req-release-materialized');
  assert.equal(observedRequest?.meta?.materializationId, 'materialized-123');
});

test('HTTP artifact download streams registered files', async (ctx) => {
  if (!(await supportsLoopbackBind())) {
    ctx.skip();
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-http-artifact-'));
  const artifactPath = path.join(root, 'screen.png');
  fs.writeFileSync(artifactPath, 'png-binary', 'utf8');
  const artifactId = trackDownloadableArtifact({
    artifactPath,
    fileName: 'screen.png',
  });
  const server = await createDaemonHttpServer({
    handleRequest: async (): Promise<DaemonResponse> => ({ ok: true, data: {} }),
    token: 'test-token',
  });
  const port = await listen(server);
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const response = await callGet(port, `/upload/${artifactId}`, {
    authorization: 'Bearer test-token',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, 'png-binary');
  assert.match(String(response.headers['content-disposition'] ?? ''), /screen\.png/);
});

test('HTTP artifact download rejects requests without the daemon token', async (ctx) => {
  if (!(await supportsLoopbackBind())) {
    ctx.skip();
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-http-artifact-auth-'));
  const artifactPath = path.join(root, 'screen.png');
  fs.writeFileSync(artifactPath, 'png-binary', 'utf8');
  const artifactId = trackDownloadableArtifact({
    artifactPath,
    fileName: 'screen.png',
  });
  const server = await createDaemonHttpServer({
    handleRequest: async (): Promise<DaemonResponse> => ({ ok: true, data: {} }),
    token: 'test-token',
  });
  const port = await listen(server);
  onTestFinished(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    fs.rmSync(root, { recursive: true, force: true });
  });

  const response = await callGet(port, `/upload/${artifactId}`);
  assert.equal(response.statusCode, 401);
  assert.match(response.body, /Invalid token/);
});
