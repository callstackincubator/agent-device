import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { buildSimctlArgs } from '../platforms/ios/simctl.ts';
import { runCmd } from '../utils/exec.ts';
import { clearPidFile, writePidFile, type AppLogResult } from './app-log-process.ts';
import { attachChildToStream, createLineWriter, waitForChildExit } from './app-log-stream.ts';

export function buildAppleLogPredicate(appBundleId: string): string {
  return [
    `subsystem == "${appBundleId}"`,
    `processImagePath ENDSWITH[c] "/${appBundleId}"`,
    `senderImagePath ENDSWITH[c] "/${appBundleId}"`,
  ].join(' OR ');
}

export function buildIosSimulatorLogStreamArgs(params: {
  deviceId: string;
  appBundleId: string;
  simulatorSetPath?: string;
}): string[] {
  const { deviceId, appBundleId, simulatorSetPath } = params;
  return buildSimctlArgs(
    [
      'spawn',
      deviceId,
      'log',
      'stream',
      '--style',
      'compact',
      '--level',
      'info',
      '--predicate',
      buildAppleLogPredicate(appBundleId),
    ],
    { simulatorSetPath },
  );
}

export function buildIosDeviceLogStreamArgs(deviceId: string): string[] {
  return ['devicectl', 'device', 'log', 'stream', '--device', deviceId];
}

export async function readRecentIosSimulatorLogShowForBundle(params: {
  deviceId: string;
  appBundleId: string;
  startedAt?: number;
  simulatorSetPath?: string;
}): Promise<{ text: string; recoveredLineCount: number } | null> {
  const { deviceId, appBundleId, startedAt, simulatorSetPath } = params;
  const args = buildSimctlArgs(
    [
      'spawn',
      deviceId,
      'log',
      'show',
      '--style',
      'compact',
      '--info',
      '--predicate',
      buildAppleLogPredicate(appBundleId),
    ],
    { simulatorSetPath },
  );
  if (typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0) {
    args.push('--start', `@${Math.floor(startedAt / 1000)}`);
  } else {
    args.push('--last', '5m');
  }
  const result = await runCmd('xcrun', args, { allowFailure: true, timeoutMs: 4_000 });
  if (result.exitCode !== 0 || result.stdout.trim().length === 0) {
    return null;
  }
  const lines = result.stdout
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => {
      const trimmed = line.trim();
      return (
        trimmed.length > 0 && !trimmed.startsWith('Timestamp               Ty Process[PID:TID]')
      );
    });
  if (lines.length === 0) {
    return null;
  }
  return {
    text: `${lines.join('\n')}\n`,
    recoveredLineCount: lines.length,
  };
}

export async function startIosSimulatorAppLog(
  deviceId: string,
  appBundleId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  simulatorSetPath?: string,
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  const child = spawn(
    'xcrun',
    buildIosSimulatorLogStreamArgs({ deviceId, appBundleId, simulatorSetPath }),
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
    ['stream', '--style', 'compact', '--predicate', buildAppleLogPredicate(appBundleId)],
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
