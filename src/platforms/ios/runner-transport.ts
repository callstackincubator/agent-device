import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequestCanceledError, isRequestCanceledError } from '../../daemon/request-cancel.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { Deadline, retryWithPolicy } from '../../utils/retry.ts';
import { resolveTimeoutMs, resolveTimeoutSeconds } from '../../utils/timeouts.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { classifyBootFailure, bootFailureHint } from '../boot-diagnostics.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';
import {
  shouldRetryRunnerConnectError,
  buildRunnerConnectError,
  buildRunnerEarlyExitError,
} from './runner-errors.ts';
import type { RunnerCommand } from './runner-client.ts';
import type { RunnerSession } from './runner-session.ts';

export const RUNNER_STARTUP_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_STARTUP_TIMEOUT_MS,
  45_000,
  5_000,
);
export const RUNNER_COMMAND_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_COMMAND_TIMEOUT_MS,
  45_000,
  1_000,
);
const RUNNER_CONNECT_ATTEMPT_INTERVAL_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_ATTEMPT_INTERVAL_MS,
  250,
  50,
);
const RUNNER_CONNECT_RETRY_BASE_DELAY_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_RETRY_BASE_DELAY_MS,
  300,
  10,
);
const RUNNER_CONNECT_RETRY_MAX_DELAY_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_RETRY_MAX_DELAY_MS,
  2_000,
  10,
);
const RUNNER_CONNECT_REQUEST_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_RUNNER_CONNECT_REQUEST_TIMEOUT_MS,
  20_000,
  250,
);
const RUNNER_DEVICE_INFO_TIMEOUT_MS = resolveTimeoutMs(
  process.env.AGENT_DEVICE_IOS_DEVICE_INFO_TIMEOUT_MS,
  10_000,
  500,
);
export const RUNNER_DESTINATION_TIMEOUT_SECONDS = resolveTimeoutSeconds(
  process.env.AGENT_DEVICE_RUNNER_DESTINATION_TIMEOUT_SECONDS,
  20,
  5,
);

export async function waitForRunner(
  device: DeviceInfo,
  port: number,
  command: RunnerCommand,
  logPath?: string,
  timeoutMs: number = RUNNER_STARTUP_TIMEOUT_MS,
  session?: RunnerSession,
  signal?: AbortSignal,
): Promise<Response> {
  const deadline = Deadline.fromTimeoutMs(timeoutMs);
  let endpoints = await resolveRunnerCommandEndpoints(device, port, deadline.remainingMs());
  let lastError: unknown = null;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / RUNNER_CONNECT_ATTEMPT_INTERVAL_MS));
  try {
    return await retryWithPolicy(
      async ({ deadline: attemptDeadline }) => {
        if (attemptDeadline?.isExpired()) {
          throw new AppError('COMMAND_FAILED', 'Runner connection deadline exceeded', {
            port,
            timeoutMs,
          });
        }
        if (session && session.child.exitCode !== null && session.child.exitCode !== undefined) {
          throw await buildRunnerEarlyExitError({ session, port, logPath });
        }
        if (device.kind === 'device') {
          endpoints = await resolveRunnerCommandEndpoints(
            device,
            port,
            attemptDeadline?.remainingMs(),
          );
        }
        for (const endpoint of endpoints) {
          try {
            const remainingMs = attemptDeadline?.remainingMs() ?? timeoutMs;
            if (remainingMs <= 0) {
              throw new AppError('COMMAND_FAILED', 'Runner connection deadline exceeded', {
                port,
                timeoutMs,
              });
            }
            const response = await fetchWithTimeout(
              endpoint,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(command),
              },
              Math.min(RUNNER_CONNECT_REQUEST_TIMEOUT_MS, remainingMs),
              signal,
            );
            return response;
          } catch (err) {
            if (signal?.aborted || isRequestCanceledError(err)) {
              throw createRequestCanceledError();
            }
            lastError = err;
          }
        }
        throw new AppError('COMMAND_FAILED', 'Runner endpoint probe failed', {
          port,
          endpoints,
          lastError: lastError ? String(lastError) : undefined,
        });
      },
      {
        maxAttempts,
        baseDelayMs: RUNNER_CONNECT_RETRY_BASE_DELAY_MS,
        maxDelayMs: RUNNER_CONNECT_RETRY_MAX_DELAY_MS,
        jitter: 0.2,
        shouldRetry: shouldRetryRunnerConnectError,
      },
      { deadline, phase: 'ios_runner_connect', signal },
    );
  } catch (error) {
    if (signal?.aborted || isRequestCanceledError(error)) {
      throw createRequestCanceledError();
    }
    if (!lastError) {
      lastError = error;
    }
  }

  if (signal?.aborted) {
    throw createRequestCanceledError();
  }

  if (device.kind === 'simulator') {
    const remainingMs = deadline.remainingMs();
    if (remainingMs <= 0) {
      throw buildRunnerConnectError({ port, endpoints, logPath, lastError });
    }
    const simResponse = await postCommandViaSimulator(device, port, command, remainingMs);
    return new Response(simResponse.body, { status: simResponse.status });
  }

  throw buildRunnerConnectError({ port, endpoints, logPath, lastError });
}

async function resolveRunnerCommandEndpoints(
  device: DeviceInfo,
  port: number,
  timeoutBudgetMs?: number,
): Promise<string[]> {
  const endpoints = [`http://127.0.0.1:${port}/command`];
  if (device.kind !== 'device') {
    return endpoints;
  }
  const tunnelIp = await resolveDeviceTunnelIp(device.id, timeoutBudgetMs);
  if (tunnelIp) {
    endpoints.unshift(`http://[${tunnelIp}]:${port}/command`);
  }
  return endpoints;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  requestSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let onRequestAbort: (() => void) | undefined;
  if (requestSignal) {
    if (requestSignal.aborted) {
      clearTimeout(timeout);
      controller.abort();
    } else {
      onRequestAbort = () => controller.abort();
      requestSignal.addEventListener('abort', onRequestAbort, { once: true });
    }
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
    if (onRequestAbort && requestSignal) {
      requestSignal.removeEventListener('abort', onRequestAbort);
    }
  }
}

async function resolveDeviceTunnelIp(
  deviceId: string,
  timeoutBudgetMs?: number,
): Promise<string | null> {
  if (typeof timeoutBudgetMs === 'number' && timeoutBudgetMs <= 0) {
    return null;
  }
  const timeoutMs =
    typeof timeoutBudgetMs === 'number'
      ? Math.max(1, Math.min(RUNNER_DEVICE_INFO_TIMEOUT_MS, timeoutBudgetMs))
      : RUNNER_DEVICE_INFO_TIMEOUT_MS;
  const jsonPath = path.join(
    os.tmpdir(),
    `agent-device-devicectl-info-${process.pid}-${Date.now()}.json`,
  );
  try {
    const devicectlTimeoutSeconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    const result = await runCmd(
      'xcrun',
      [
        'devicectl',
        'device',
        'info',
        'details',
        '--device',
        deviceId,
        '--json-output',
        jsonPath,
        '--timeout',
        String(devicectlTimeoutSeconds),
      ],
      { allowFailure: true, timeoutMs },
    );
    if (result.exitCode !== 0 || !fs.existsSync(jsonPath)) {
      return null;
    }
    const payload = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
      info?: { outcome?: string };
      result?: {
        connectionProperties?: { tunnelIPAddress?: string };
        device?: { connectionProperties?: { tunnelIPAddress?: string } };
      };
    };
    if (payload.info?.outcome && payload.info.outcome !== 'success') {
      return null;
    }
    const ip = (
      payload.result?.connectionProperties?.tunnelIPAddress ??
      payload.result?.device?.connectionProperties?.tunnelIPAddress
    )?.trim();
    return ip && ip.length > 0 ? ip : null;
  } catch {
    return null;
  } finally {
    cleanupTempFile(jsonPath);
  }
}

async function postCommandViaSimulator(
  device: DeviceInfo,
  port: number,
  command: RunnerCommand,
  timeoutMs: number,
): Promise<{ status: number; body: string }> {
  const payload = JSON.stringify(command);
  const args = buildSimctlArgsForDevice(device, [
    'spawn',
    device.id,
    '/usr/bin/curl',
    '-s',
    '-X',
    'POST',
    '-H',
    'Content-Type: application/json',
    '--data',
    payload,
    `http://127.0.0.1:${port}/command`,
  ]);
  const result = await runCmd('xcrun', args, { allowFailure: true, timeoutMs });
  const body = result.stdout as string;
  if (result.exitCode !== 0) {
    const reason = classifyBootFailure({
      message: 'Runner did not accept connection (simctl spawn)',
      stdout: result.stdout,
      stderr: result.stderr,
      context: { platform: 'ios', phase: 'connect' },
    });
    throw new AppError('COMMAND_FAILED', 'Runner did not accept connection (simctl spawn)', {
      port,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      reason,
      hint: bootFailureHint(reason),
    });
  }
  return { status: 200, body };
}

export async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close();
      if (typeof address === 'object' && address?.port) {
        resolve(address.port);
      } else {
        reject(new AppError('COMMAND_FAILED', 'Failed to allocate port'));
      }
    });
    server.on('error', reject);
  });
}

export function logChunk(
  chunk: string,
  logPath?: string,
  traceLogPath?: string,
  verbose?: boolean,
): void {
  if (logPath) fs.appendFileSync(logPath, chunk);
  if (traceLogPath) fs.appendFileSync(traceLogPath, chunk);
  if (verbose) {
    process.stderr.write(chunk);
  }
}

export function cleanupTempFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    // ignore
  }
}
