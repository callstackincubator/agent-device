import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { clearPidFile, writePidFile, type AppLogResult } from './app-log-process.ts';
import { attachChildToStream, createLineWriter, waitForChildExit } from './app-log-stream.ts';

export function buildIosLogPredicate(appBundleId: string): string {
  return [
    `subsystem == "${appBundleId}"`,
    `processImagePath ENDSWITH[c] "/${appBundleId}"`,
    `senderImagePath ENDSWITH[c] "/${appBundleId}"`,
    `eventMessage CONTAINS[c] "${appBundleId}"`,
  ].join(' OR ');
}

export function buildIosDeviceLogStreamArgs(deviceId: string): string[] {
  return ['devicectl', 'device', 'log', 'stream', '--device', deviceId];
}

export async function startIosSimulatorAppLog(
  appBundleId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  const child = spawn(
    'log',
    ['stream', '--style', 'compact', '--predicate', buildIosLogPredicate(appBundleId)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const writer = createLineWriter(stream, { redactionPatterns });
  if (typeof child.pid === 'number') {
    writePidFile(pidPath, child.pid);
  }
  const wait = attachChildToStream(child, stream, { endStreamOnClose: true, writer }).then(
    (result) => {
      if (result.exitCode !== 0) state = 'failed';
      clearPidFile(pidPath);
      return result;
    },
  );
  return {
    backend: 'ios-simulator',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      if (!child.killed) child.kill('SIGINT');
      await waitForChildExit(wait);
      if (!child.killed) child.kill('SIGKILL');
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}

export async function startMacOsAppLog(
  appBundleId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  const child = spawn(
    'log',
    ['stream', '--style', 'compact', '--predicate', buildIosLogPredicate(appBundleId)],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const writer = createLineWriter(stream, { redactionPatterns });
  if (typeof child.pid === 'number') {
    writePidFile(pidPath, child.pid);
  }
  const wait = attachChildToStream(child, stream, { endStreamOnClose: true, writer }).then(
    (result) => {
      if (result.exitCode !== 0) state = 'failed';
      clearPidFile(pidPath);
      return result;
    },
  );
  return {
    backend: 'macos',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      if (!child.killed) child.kill('SIGINT');
      await waitForChildExit(wait);
      if (!child.killed) child.kill('SIGKILL');
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}

export async function startIosDeviceAppLog(
  deviceId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  const child = spawn('xcrun', buildIosDeviceLogStreamArgs(deviceId), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const writer = createLineWriter(stream, { redactionPatterns });
  if (typeof child.pid === 'number') {
    writePidFile(pidPath, child.pid);
  }
  const wait = attachChildToStream(child, stream, { endStreamOnClose: true, writer }).then(
    (result) => {
      if (result.exitCode !== 0) state = 'failed';
      clearPidFile(pidPath);
      return result;
    },
  );
  return {
    backend: 'ios-device',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      if (!child.killed) child.kill('SIGINT');
      await waitForChildExit(wait);
      if (!child.killed) child.kill('SIGKILL');
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}
