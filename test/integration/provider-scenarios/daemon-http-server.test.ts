import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { AppError } from '../../../src/utils/errors.ts';
import { trackDownloadableArtifact } from '../../../src/daemon/artifact-tracking.ts';
import { createDaemonHttpServer } from '../../../src/daemon/http-server.ts';
import { isRequestCanceled } from '../../../src/daemon/request-cancel.ts';
import type { DaemonRequest, DaemonResponse } from '../../../src/daemon/types.ts';
import {
  closeLoopbackServer,
  listenOnLoopback,
  skipWhenLoopbackUnavailable,
} from '../../../src/__tests__/test-utils/loopback.ts';
import { restoreEnv } from './harness.ts';

type RpcResponse = {
  status: number;
  body: {
    result?: DaemonResponse;
    error?: {
      code: number;
      message: string;
      data?: Record<string, unknown>;
    };
  };
};

test('Provider-backed integration daemon HTTP server maps RPC methods, auth, and request cancellation through the real transport', async (t) => {
  if (await skipWhenLoopbackUnavailable(t, 'daemon HTTP integration coverage')) {
    return;
  }

  const observedRequests: DaemonRequest[] = [];
  let observedCanceled: boolean | undefined;
  const server = await createDaemonHttpServer({
    token: 'provider-scenario-token',
    handleRequest: async (req): Promise<DaemonResponse> => {
      observedRequests.push(req);
      if (req.command === 'session_list') {
        await new Promise((resolve) => setTimeout(resolve, 25));
        observedCanceled = isRequestCanceled(req.meta?.requestId);
      }
      if (req.command === 'fail_me') {
        throw new AppError('INVALID_ARGS', 'real transport rejected the request', {
          command: req.command,
        });
      }
      return {
        ok: true,
        data: {
          command: req.command,
          session: req.session,
          meta: req.meta,
          flags: req.flags,
        },
      };
    },
  });

  try {
    const port = await listenOnLoopback(server);

    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    const command = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-command',
      method: 'agent_device.command',
      params: {
        session: 'default',
        command: 'session_list',
        positionals: [],
        meta: { requestId: 'req-command' },
      },
    });
    assert.equal(command.status, 200);
    assert.equal(command.body.result?.ok, true);
    assert.equal(observedCanceled, false);

    const installFromUrl = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-install-url',
      method: 'agent_device.install_from_source',
      params: {
        session: 'bootstrap',
        platform: 'android',
        requestId: 'req-install-url',
        retainPaths: true,
        retentionMs: 30000,
        source: {
          kind: 'url',
          url: 'https://example.com/app.apk',
          headers: { authorization: 'Bearer signed-token' },
        },
      },
    });
    assert.equal(installFromUrl.status, 200);

    const installFromGitHub = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-install-github',
      method: 'agent_device.install_from_source',
      params: {
        session: 'bootstrap',
        platform: 'ios',
        source: {
          kind: 'github-actions-artifact',
          owner: 'acme',
          repo: 'mobile',
          runId: '1234567890',
          artifactName: 'ios-debug',
        },
      },
    });
    assert.equal(installFromGitHub.status, 200);

    const lease = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-lease',
      method: 'agent_device.lease.allocate',
      params: {
        tenantId: 'Tenant A',
        runId: 'run-1',
        ttlMs: 60000,
        backend: 'android-instance',
      },
    });
    assert.equal(lease.status, 200);

    const release = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-release',
      method: 'agent_device.release_materialized_paths',
      params: {
        session: 'bootstrap',
        requestId: 'req-release',
        materializationId: 'materialized-1',
      },
    });
    assert.equal(release.status, 200);

    const failure = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-failure',
      method: 'agent_device.command',
      params: {
        command: 'fail_me',
        positionals: [],
      },
    });
    assert.equal(failure.status, 400);
    assert.equal(failure.body.error?.data?.code, 'INVALID_ARGS');
    assert.equal(
      (failure.body.error?.data?.details as Record<string, unknown> | undefined)?.command,
      'fail_me',
    );

    const unsupported = await callRpc(port, {
      jsonrpc: '2.0',
      id: 'rpc-missing',
      method: 'agent_device.missing',
      params: {},
    });
    assert.equal(unsupported.status, 404);
    assert.equal(unsupported.body.error?.code, -32601);

    const installUrlRequest = observedRequests.find(
      (req) => req.meta?.requestId === 'req-install-url',
    );
    assert.equal(installUrlRequest?.command, 'install_source');
    assert.equal(installUrlRequest?.session, 'bootstrap');
    assert.equal(installUrlRequest?.flags?.platform, 'android');
    assert.equal(installUrlRequest?.meta?.retainMaterializedPaths, true);
    assert.equal(installUrlRequest?.meta?.materializedPathRetentionMs, 30000);
    assert.deepEqual(installUrlRequest?.meta?.installSource, {
      kind: 'url',
      url: 'https://example.com/app.apk',
      headers: { authorization: 'Bearer signed-token' },
    });

    const githubRequest = observedRequests.find(
      (req) => req.command === 'install_source' && req.flags?.platform === 'ios',
    );
    assert.deepEqual(githubRequest?.meta?.installSource, {
      kind: 'github-actions-artifact',
      owner: 'acme',
      repo: 'mobile',
      runId: 1234567890,
      artifactName: 'ios-debug',
    });

    const leaseRequest = observedRequests.find((req) => req.command === 'lease_allocate');
    assert.equal(leaseRequest?.meta?.tenantId, 'Tenant A');
    assert.equal(leaseRequest?.meta?.leaseTtlMs, 60000);
    assert.equal(leaseRequest?.meta?.leaseBackend, 'android-instance');

    const releaseRequest = observedRequests.find(
      (req) => req.command === 'release_materialized_paths',
    );
    assert.equal(releaseRequest?.meta?.materializationId, 'materialized-1');
  } finally {
    await closeLoopbackServer(server);
  }
});

test('Provider-backed integration daemon HTTP server accepts uploads and streams downloadable artifacts', async (t) => {
  if (await skipWhenLoopbackUnavailable(t, 'daemon HTTP integration coverage')) {
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-http-server-'));
  const downloadablePath = path.join(root, 'screen.png');
  fs.writeFileSync(downloadablePath, 'png-binary');
  const artifactId = trackDownloadableArtifact({
    artifactPath: downloadablePath,
    fileName: 'screen.png',
  });
  const server = await createDaemonHttpServer({
    token: 'provider-scenario-token',
    handleRequest: async (): Promise<DaemonResponse> => ({ ok: true, data: {} }),
  });

  try {
    const port = await listenOnLoopback(server);

    const upload = await fetch(`http://127.0.0.1:${port}/upload`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer provider-scenario-token',
        'x-artifact-type': 'file',
        'x-artifact-filename': 'demo.apk',
        'content-type': 'application/octet-stream',
      },
      body: Buffer.from('fake-apk'),
    });
    assert.equal(upload.status, 200);
    const uploadBody = (await upload.json()) as { ok?: boolean; uploadId?: string };
    assert.equal(uploadBody.ok, true);
    assert.equal(typeof uploadBody.uploadId, 'string');

    const downloaded = await fetch(`http://127.0.0.1:${port}/artifacts/${artifactId}`, {
      headers: { authorization: 'Bearer provider-scenario-token' },
    });
    assert.equal(downloaded.status, 200);
    assert.equal(await downloaded.text(), 'png-binary');
    assert.match(downloaded.headers.get('content-disposition') ?? '', /screen\.png/);

    const rejectedUpload = await fetch(`http://127.0.0.1:${port}/upload`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'x-artifact-type': 'file',
        'x-artifact-filename': 'demo.apk',
      },
      body: Buffer.from('fake-apk'),
    });
    assert.equal(rejectedUpload.status, 401);
  } finally {
    await closeLoopbackServer(server);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('Provider-backed integration daemon HTTP auth hook can scope tenants and reject requests', async (t) => {
  if (await skipWhenLoopbackUnavailable(t, 'daemon HTTP integration coverage')) {
    return;
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-http-auth-hook-'));
  const hookPath = path.join(root, 'auth-hook.mjs');
  fs.writeFileSync(
    hookPath,
    `export default function authHook({ headers }) {
      if (headers['x-reject'] === 'yes') return { ok: false, code: 'UNAUTHORIZED', message: 'tenant rejected' };
      return { tenantId: headers['x-tenant'] || 'tenant-hook' };
    }`,
  );
  const previousHook = process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;
  process.env.AGENT_DEVICE_HTTP_AUTH_HOOK = hookPath;

  let observedRequest: DaemonRequest | undefined;
  let server: Awaited<ReturnType<typeof createDaemonHttpServer>> | undefined;

  try {
    server = await createDaemonHttpServer({
      handleRequest: async (req): Promise<DaemonResponse> => {
        observedRequest = req;
        return { ok: true, data: { meta: req.meta } };
      },
    });
    const port = await listenOnLoopback(server);
    const accepted = await callRpc(
      port,
      {
        jsonrpc: '2.0',
        id: 'rpc-auth-hook',
        method: 'agent_device.command',
        params: {
          command: 'session_list',
          flags: { sessionIsolation: 'tenant' },
        },
      },
      { 'x-tenant': 'tenant-hook' },
    );
    assert.equal(accepted.status, 200);
    assert.equal(observedRequest?.meta?.tenantId, 'tenant-hook');
    assert.equal(observedRequest?.meta?.sessionIsolation, 'tenant');

    const rejected = await callRpc(
      port,
      {
        jsonrpc: '2.0',
        id: 'rpc-auth-reject',
        method: 'agent_device.command',
        params: {
          command: 'session_list',
        },
      },
      { 'x-reject': 'yes' },
    );
    assert.equal(rejected.status, 401);
    assert.equal(rejected.body.error?.data?.message, 'tenant rejected');
  } finally {
    if (server) {
      await closeLoopbackServer(server);
    }
    restoreEnv('AGENT_DEVICE_HTTP_AUTH_HOOK', previousHook);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function callRpc(
  port: number,
  payload: Record<string, unknown>,
  headers: Record<string, string> = { authorization: 'Bearer provider-scenario-token' },
): Promise<RpcResponse> {
  const response = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    body: (await response.json()) as RpcResponse['body'],
  };
}
