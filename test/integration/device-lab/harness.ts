import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAgentDeviceClient } from '../../../src/client.ts';
import type { AgentDeviceClient, AgentDeviceDaemonTransport } from '../../../src/client-types.ts';
import {
  createRequestHandler,
  type RequestRouterDeps,
} from '../../../src/daemon/request-router.ts';
import { trackDownloadableArtifact } from '../../../src/daemon/artifact-tracking.ts';
import { LeaseRegistry } from '../../../src/daemon/lease-registry.ts';
import { SessionStore } from '../../../src/daemon/session-store.ts';
import type { DaemonRequest, DaemonResponse } from '../../../src/daemon/types.ts';

export const DEVICE_LAB_TOKEN = 'device-lab-token';

export type DeviceLabRpcResult = { statusCode: number; json: any };

export type DeviceLabHarness = {
  callCommand: (
    command: string,
    positionals?: string[],
    flags?: DaemonRequest['flags'],
  ) => Promise<DeviceLabRpcResult>;
  client: () => AgentDeviceClient;
  close: () => Promise<void>;
};

export async function createDeviceLabHarness(
  deps: Partial<RequestRouterDeps> & Pick<RequestRouterDeps, 'deviceInventoryProvider'>,
): Promise<DeviceLabHarness> {
  const sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-lab-session-'));
  const handleRequest = createRequestHandler({
    logPath: path.join(os.tmpdir(), 'agent-device-lab-daemon.log'),
    token: DEVICE_LAB_TOKEN,
    sessionStore: new SessionStore(sessionDir),
    leaseRegistry: new LeaseRegistry(),
    trackDownloadableArtifact,
    ...deps,
  });

  const transport: AgentDeviceDaemonTransport = async (req) =>
    await handleRequest({
      token: DEVICE_LAB_TOKEN,
      session: req.session ?? 'default',
      command: req.command,
      positionals: req.positionals,
      flags: req.flags,
      runtime: req.runtime,
      meta: req.meta as DaemonRequest['meta'],
    });

  return {
    callCommand: async (command, positionals = [], flags = {}) =>
      responseToRpcResult(
        await handleRequest(commandRequest(command, positionals, flags)),
        `direct-${command}-${Date.now()}`,
      ),
    client: () => createAgentDeviceClient({}, { transport }),
    close: async () => {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    },
  };
}

export function restoreEnv(key: string, previous: string | undefined): void {
  if (previous === undefined) delete process.env[key];
  else process.env[key] = previous;
}

function commandRequest(
  command: string,
  positionals: string[] = [],
  flags: DaemonRequest['flags'] = {},
): DaemonRequest {
  return {
    token: DEVICE_LAB_TOKEN,
    session: 'default',
    command,
    positionals,
    flags,
  };
}

function responseToRpcResult(response: DaemonResponse, id: string): DeviceLabRpcResult {
  return {
    statusCode: 200,
    json: response.ok
      ? {
          jsonrpc: '2.0',
          id,
          result: { data: response.data ?? {} },
        }
      : {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: response.error.message,
            data: response.error,
          },
        },
  };
}
