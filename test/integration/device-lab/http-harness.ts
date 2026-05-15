import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createDaemonHttpServer } from '../../../src/daemon/http-server.ts';
import {
  createRequestHandler,
  type RequestRouterDeps,
} from '../../../src/daemon/request-router.ts';
import { trackDownloadableArtifact } from '../../../src/daemon/artifact-tracking.ts';
import { LeaseRegistry } from '../../../src/daemon/lease-registry.ts';
import { SessionStore } from '../../../src/daemon/session-store.ts';
import type { DaemonRequest } from '../../../src/daemon/types.ts';

export const DEVICE_LAB_TOKEN = 'device-lab-token';

export type DeviceLabRpcResult = { statusCode: number; json: any };

export type DeviceLabDaemon = {
  baseUrl: string;
  token: string;
  callCommand: (
    command: string,
    positionals?: string[],
    flags?: DaemonRequest['flags'],
  ) => Promise<DeviceLabRpcResult>;
  close: () => Promise<void>;
};

export async function startDeviceLabDaemon(
  deps: Partial<RequestRouterDeps> & Pick<RequestRouterDeps, 'deviceInventoryProvider'>,
): Promise<DeviceLabDaemon> {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-lab-session-'));
  const server = await createDaemonHttpServer({
    handleRequest: createRequestHandler({
      logPath: path.join(os.tmpdir(), 'agent-device-lab-daemon.log'),
      token: DEVICE_LAB_TOKEN,
      sessionStore: new SessionStore(sessionDir),
      leaseRegistry: new LeaseRegistry(),
      trackDownloadableArtifact,
      ...deps,
    }),
  });
  const port = await listen(server);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    token: DEVICE_LAB_TOKEN,
    callCommand: async (command, positionals = [], flags = {}) =>
      await callRpc(port, commandRpcPayload(command, positionals, flags)),
    close: async () => {
      await closeServer(server);
      fs.rmSync(sessionDir, { recursive: true, force: true });
    },
  };
}

export function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

export async function withDeviceLabRemoteEnv<T>(
  daemon: Pick<DeviceLabDaemon, 'baseUrl' | 'token'>,
  run: () => Promise<T>,
): Promise<T> {
  const previousBaseUrl = process.env.AGENT_DEVICE_DAEMON_BASE_URL;
  const previousAuthToken = process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN;
  const previousTransport = process.env.AGENT_DEVICE_DAEMON_TRANSPORT;
  process.env.AGENT_DEVICE_DAEMON_BASE_URL = daemon.baseUrl;
  process.env.AGENT_DEVICE_DAEMON_AUTH_TOKEN = daemon.token;
  process.env.AGENT_DEVICE_DAEMON_TRANSPORT = 'http';
  try {
    return await run();
  } finally {
    restoreEnv('AGENT_DEVICE_DAEMON_BASE_URL', previousBaseUrl);
    restoreEnv('AGENT_DEVICE_DAEMON_AUTH_TOKEN', previousAuthToken);
    restoreEnv('AGENT_DEVICE_DAEMON_TRANSPORT', previousTransport);
  }
}

function commandRpcPayload(
  command: string,
  positionals: string[] = [],
  flags: DaemonRequest['flags'] = {},
): Record<string, unknown> {
  return {
    jsonrpc: '2.0',
    id: `rpc-${command}-${Date.now()}`,
    method: 'agent_device.command',
    params: {
      token: DEVICE_LAB_TOKEN,
      session: 'default',
      command,
      positionals,
      flags,
    },
  };
}

async function callRpc(
  port: number,
  payload: Record<string, unknown>,
): Promise<DeviceLabRpcResult> {
  const body = JSON.stringify(payload);
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      req.destroy();
      reject(new Error(`Timed out waiting for RPC response: ${body}`));
    }, 5_000);
    const req = http.request(
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
      (res) => {
        let responseBody = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          clearTimeout(timeout);
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
    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    req.write(body);
    req.end();
  });
}

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }
  return address.port;
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections();
  server.closeIdleConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}
