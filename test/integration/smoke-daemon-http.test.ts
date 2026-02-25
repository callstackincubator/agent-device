import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { runCmdSync } from '../../src/utils/exec.ts';
import { stopProcessForTakeover } from '../../src/utils/process-identity.ts';

type CliJsonResult = {
  status: number;
  json?: any;
  stdout: string;
  stderr: string;
};

type DaemonInfo = {
  token: string;
  pid: number;
  processStartTime?: string;
  transport?: string;
  httpPort?: number;
};

let loopbackBindSupportPromise: Promise<boolean> | null = null;

function runCliJson(args: string[], env?: NodeJS.ProcessEnv): CliJsonResult {
  const result = runCmdSync(
    process.execPath,
    ['--experimental-strip-types', 'src/bin.ts', ...args],
    {
      allowFailure: true,
      env: {
        ...process.env,
        ...env,
      },
    },
  );
  let json: any;
  try {
    json = JSON.parse(result.stdout ?? '');
  } catch {
    json = undefined;
  }
  return {
    status: result.exitCode,
    json,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

function readDaemonInfo(stateDir: string): DaemonInfo {
  const infoPath = path.join(stateDir, 'daemon.json');
  const infoText = fs.readFileSync(infoPath, 'utf8');
  return JSON.parse(infoText) as DaemonInfo;
}

async function callRpc(
  port: number,
  payload: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; json: any }> {
  const body = JSON.stringify(payload);
  return await new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': String(Buffer.byteLength(body)),
          ...headers,
        },
      },
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          try {
            resolve({
              statusCode: res.statusCode ?? 0,
              json: JSON.parse(responseBody),
            });
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callCommandRpc(
  info: DaemonInfo,
  command: string,
  flags: Record<string, unknown> = {},
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; json: any }> {
  return await callRpc(
    info.httpPort as number,
    commandRpcPayload(info.token, command, flags),
    headers,
  );
}

async function callLeaseRpc(
  info: DaemonInfo,
  method: 'allocate' | 'heartbeat' | 'release',
  params: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ statusCode: number; json: any }> {
  return await callRpc(
    info.httpPort as number,
    leaseRpcPayload(info.token, method, params),
    headers,
  );
}

async function stopDaemonForStateDir(stateDir: string): Promise<void> {
  try {
    const infoPath = path.join(stateDir, 'daemon.json');
    if (!fs.existsSync(infoPath)) {
      return;
    }
    const info = readDaemonInfo(stateDir);
    if (!Number.isInteger(info.pid) || info.pid <= 0) {
      return;
    }
    await stopProcessForTakeover(info.pid, {
      termTimeoutMs: 1500,
      killTimeoutMs: 1500,
      expectedStartTime: info.processStartTime,
    });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

function commandRpcPayload(
  token: string,
  command: string,
  flags: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: `rpc-${Date.now()}`,
    method: 'agent_device.command',
    params: {
      token,
      session: 'default',
      command,
      positionals: [],
      flags,
    },
  };
}

function leaseRpcPayload(
  token: string,
  method: 'allocate' | 'heartbeat' | 'release',
  params: Record<string, unknown>,
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: `lease-${method}-${Date.now()}`,
    method: `agent_device.lease.${method}`,
    params: {
      token,
      ...params,
    },
  };
}

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

function isTruthy(raw: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((raw ?? '').toLowerCase());
}

function shouldRequireLoopbackCoverage(): boolean {
  return isTruthy(process.env.AGENT_DEVICE_REQUIRE_LOOPBACK_TESTS);
}

test('daemon HTTP JSON-RPC flow honors custom state dir and tenant isolation controls', async (t) => {
  if (!(await supportsLoopbackBind())) {
    if (shouldRequireLoopbackCoverage()) {
      assert.fail('loopback listeners are required for daemon HTTP integration coverage');
    }
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-http-flow-'));
  try {
    const cli = runCliJson(
      ['session', 'list', '--json', '--daemon-transport', 'http', '--state-dir', stateDir],
      { AGENT_DEVICE_DAEMON_SERVER_MODE: 'http' },
    );

    assert.equal(cli.status, 0, `${cli.stderr}\n${cli.stdout}`);
    assert.equal(cli.json?.success, true, JSON.stringify(cli.json));

    const info = readDaemonInfo(stateDir);
    assert.equal(info.transport, 'http');
    assert.equal(typeof info.httpPort, 'number');
    assert.ok((info.httpPort ?? 0) > 0);

    const okResponse = await callCommandRpc(info, 'session_list');
    assert.equal(okResponse.statusCode, 200);
    assert.equal(okResponse.json?.result?.ok, true, JSON.stringify(okResponse.json));

    const missingTenantResponse = await callCommandRpc(info, 'session_list', { sessionIsolation: 'tenant' });
    assert.equal(missingTenantResponse.statusCode, 400);
    assert.equal(missingTenantResponse.json?.error?.code, -32000);
    assert.equal(missingTenantResponse.json?.error?.data?.code, 'INVALID_ARGS');

    const leaseAllocate = await callLeaseRpc(info, 'allocate', {
      tenantId: 'acme',
      runId: 'run-http-flow',
      ttlMs: 60_000,
    });
    assert.equal(leaseAllocate.statusCode, 200);
    const leaseId = leaseAllocate.json?.result?.data?.lease?.leaseId;
    assert.equal(typeof leaseId, 'string');

    const missingLeaseResponse = await callCommandRpc(info, 'close', {
      sessionIsolation: 'tenant',
      tenant: 'acme',
      runId: 'run-http-flow',
    });
    assert.equal(missingLeaseResponse.statusCode, 400);
    assert.equal(missingLeaseResponse.json?.error?.data?.code, 'INVALID_ARGS');

    const tenantScopedResponse = await callCommandRpc(info, 'close', {
      sessionIsolation: 'tenant',
      tenant: 'acme',
      runId: 'run-http-flow',
      leaseId,
    });
    assert.equal(tenantScopedResponse.statusCode, 404);
    assert.equal(tenantScopedResponse.json?.error?.data?.code, 'SESSION_NOT_FOUND');

    const heartbeatResponse = await callLeaseRpc(info, 'heartbeat', {
      leaseId,
      ttlMs: 60_000,
    });
    assert.equal(heartbeatResponse.statusCode, 200);
    assert.equal(heartbeatResponse.json?.result?.ok, true, JSON.stringify(heartbeatResponse.json));

    const releaseResponse = await callLeaseRpc(info, 'release', { leaseId });
    assert.equal(releaseResponse.statusCode, 200);
    assert.equal(releaseResponse.json?.result?.data?.released, true);

    const deniedAfterRelease = await callCommandRpc(info, 'close', {
      sessionIsolation: 'tenant',
      tenant: 'acme',
      runId: 'run-http-flow',
      leaseId,
    });
    assert.equal(deniedAfterRelease.statusCode, 401);
    assert.equal(deniedAfterRelease.json?.error?.data?.code, 'UNAUTHORIZED');
  } finally {
    await stopDaemonForStateDir(stateDir);
  }
});

test('daemon HTTP auth hook can reject and inject tenant context', async (t) => {
  if (!(await supportsLoopbackBind())) {
    if (shouldRequireLoopbackCoverage()) {
      assert.fail('loopback listeners are required for daemon HTTP integration coverage');
    }
    t.skip('loopback listeners are not permitted in this environment');
    return;
  }
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-http-auth-'));
  const hookPath = path.join(stateDir, 'auth-hook.mjs');
  fs.writeFileSync(
    hookPath,
    [
      'export default async function authHook(ctx) {',
      "  const raw = ctx.headers['x-test-auth'];",
      '  const value = Array.isArray(raw) ? raw[0] : raw;',
      "  if (value !== 'allow') {",
      "    return { ok: false, code: 'UNAUTHORIZED', message: 'blocked by integration hook' };",
      '  }',
      "  return { ok: true, tenantId: 'hooktenant' };",
      '}',
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const cli = runCliJson(
      ['session', 'list', '--json', '--daemon-transport', 'http', '--state-dir', stateDir],
      {
        AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
        AGENT_DEVICE_HTTP_AUTH_HOOK: hookPath,
      },
    );

    assert.equal(cli.status, 1, `${cli.stderr}\n${cli.stdout}`);
    assert.equal(cli.json?.success, false, JSON.stringify(cli.json));
    assert.equal(cli.json?.error?.code, 'UNAUTHORIZED', JSON.stringify(cli.json));

    const info = readDaemonInfo(stateDir);

    const denied = await callCommandRpc(info, 'session_list');
    assert.equal(denied.statusCode, 401);
    assert.equal(denied.json?.error?.code, -32001);
    assert.equal(denied.json?.error?.data?.code, 'UNAUTHORIZED');

    const allocate = await callLeaseRpc(
      info,
      'allocate',
      { runId: 'auth-hook-run' },
      { 'x-test-auth': 'allow' },
    );
    assert.equal(allocate.statusCode, 200);
    const leaseId = allocate.json?.result?.data?.lease?.leaseId;
    assert.equal(typeof leaseId, 'string');
    assert.equal(allocate.json?.result?.data?.lease?.tenantId, 'hooktenant');

    const allowed = await callCommandRpc(
      info,
      'close',
      {
        sessionIsolation: 'tenant',
        runId: 'auth-hook-run',
        leaseId,
      },
      { 'x-test-auth': 'allow' },
    );
    assert.equal(allowed.statusCode, 404);
    assert.equal(allowed.json?.error?.data?.code, 'SESSION_NOT_FOUND');
  } finally {
    await stopDaemonForStateDir(stateDir);
  }
});
