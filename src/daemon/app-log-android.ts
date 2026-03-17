import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { AppError } from '../utils/errors.ts';
import { runCmd } from '../utils/exec.ts';
import { clearPidFile, writePidFile, type AppLogResult } from './app-log-process.ts';
import {
  attachChildToStream,
  createLineWriter,
  sleep,
  waitForChildExit,
} from './app-log-stream.ts';

export function assertAndroidPackageArgSafe(appBundleId: string): void {
  if (!/^[a-zA-Z0-9._:-]+$/.test(appBundleId)) {
    throw new AppError('INVALID_ARGS', `Invalid Android package name for logs: ${appBundleId}`);
  }
}

async function resolveAndroidPid(deviceId: string, appBundleId: string): Promise<string | null> {
  const pidResult = await runCmd('adb', ['-s', deviceId, 'shell', 'pidof', appBundleId], {
    allowFailure: true,
  });
  const pid = pidResult.stdout.trim().split(/\s+/)[0];
  if (!pid || !/^\d+$/.test(pid)) return null;
  return pid;
}

export async function startAndroidAppLog(
  deviceId: string,
  appBundleId: string,
  stream: fs.WriteStream,
  redactionPatterns: RegExp[],
  pidPath?: string,
): Promise<AppLogResult> {
  let state: 'active' | 'failed' = 'active';
  let stopped = false;
  let activeChild: ReturnType<typeof spawn> | undefined;
  let activeWait: ReturnType<typeof attachChildToStream> | undefined;

  const wait = (async () => {
    try {
      while (!stopped) {
        const pid = await resolveAndroidPid(deviceId, appBundleId);
        if (!pid) {
          await sleep(1_000);
          continue;
        }
        const child = spawn('adb', ['-s', deviceId, 'logcat', '-v', 'time', '--pid', pid], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        activeChild = child;
        const writer = createLineWriter(stream, { redactionPatterns });
        activeWait = attachChildToStream(child, stream, { endStreamOnClose: false, writer });
        if (typeof child.pid === 'number') {
          writePidFile(pidPath, child.pid);
        }
        const result = await activeWait;
        clearPidFile(pidPath);
        activeChild = undefined;
        activeWait = undefined;
        if (stopped) return { stdout: '', stderr: '', exitCode: 0 };
        if (result.exitCode !== 0) {
          state = 'failed';
        }
        await sleep(500);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    } finally {
      stream.end();
      clearPidFile(pidPath);
    }
  })();

  return {
    backend: 'android',
    getState: () => state,
    startedAt: Date.now(),
    wait,
    stop: async () => {
      stopped = true;
      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGINT');
      }
      if (activeWait) await waitForChildExit(activeWait);
      if (activeChild && !activeChild.killed) {
        activeChild.kill('SIGKILL');
      }
      await waitForChildExit(wait);
      clearPidFile(pidPath);
    },
  };
}
