import fs from 'node:fs';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import type { RecordTraceDeps } from './record-trace-recording.ts';

const ANDROID_REMOTE_FILE_POLL_MS = 250;
const ANDROID_REMOTE_FILE_ATTEMPTS = 20;
const ANDROID_LOCAL_VIDEO_ATTEMPTS = 6;
const ANDROID_LOCAL_VIDEO_POLL_MS = 500;
const ANDROID_PROCESS_EXIT_POLL_MS = 250;
const ANDROID_PROCESS_EXIT_ATTEMPTS = 40;

type AndroidDevice = SessionState['device'];
type AndroidRecording = Extract<NonNullable<SessionState['recording']>, { platform: 'android' }>;
type AndroidRecordingBase = Pick<
  AndroidRecording,
  'outPath' | 'clientOutPath' | 'startedAt' | 'showTouches' | 'gestureEvents'
>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function failedExecMessage(
  result: { stdout: string; stderr: string; exitCode: number },
  command: string,
): string {
  return (
    result.stderr.trim() || result.stdout.trim() || `${command} exited with code ${result.exitCode}`
  );
}

function parseAndroidRemotePid(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .at(-1);
}

function inspectMp4TopLevelAtoms(filePath: string): string[] {
  try {
    const fd = fs.openSync(filePath, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      let offset = 0;
      const atoms: string[] = [];
      while (offset + 8 <= size && atoms.length < 12) {
        const header = Buffer.alloc(8);
        const bytesRead = fs.readSync(fd, header, 0, 8, offset);
        if (bytesRead < 8) {
          break;
        }

        let atomSize = header.readUInt32BE(0);
        const atomType = header.toString('latin1', 4, 8);
        atoms.push(atomType);

        if (atomSize === 1) {
          const extended = Buffer.alloc(8);
          const extendedRead = fs.readSync(fd, extended, 0, 8, offset + 8);
          if (extendedRead < 8) {
            break;
          }
          atomSize = Number(extended.readBigUInt64BE(0));
        }

        if (!Number.isFinite(atomSize) || atomSize <= 0) {
          break;
        }
        offset += atomSize;
      }
      return atoms;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
}

async function isAndroidProcessRunning(
  deps: RecordTraceDeps,
  deviceId: string,
  pid: string,
): Promise<boolean> {
  const result = await deps.runCmd(
    'adb',
    ['-s', deviceId, 'shell', 'ps', '-o', 'pid=', '-p', pid],
    {
      allowFailure: true,
    },
  );
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .includes(pid);
}

async function waitForAndroidProcessExit(
  deps: RecordTraceDeps,
  deviceId: string,
  pid: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < ANDROID_PROCESS_EXIT_ATTEMPTS; attempt += 1) {
    if (!(await isAndroidProcessRunning(deps, deviceId, pid))) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, ANDROID_PROCESS_EXIT_POLL_MS));
  }
  return !(await isAndroidProcessRunning(deps, deviceId, pid));
}

async function waitForAndroidRemoteFileStability(
  deps: RecordTraceDeps,
  deviceId: string,
  remotePath: string,
): Promise<void> {
  let previousSize: string | undefined;
  let stableCount = 0;

  for (let attempt = 0; attempt < ANDROID_REMOTE_FILE_ATTEMPTS; attempt += 1) {
    const statResult = await deps.runCmd(
      'adb',
      ['-s', deviceId, 'shell', 'stat', '-c', '%s', remotePath],
      { allowFailure: true },
    );
    const currentSize = statResult.exitCode === 0 ? statResult.stdout.trim() : '';
    if (currentSize.length > 0 && currentSize === previousSize) {
      stableCount += 1;
      if (stableCount >= 2) {
        return;
      }
    } else {
      stableCount = 0;
    }
    previousSize = currentSize;
    await new Promise((resolve) => setTimeout(resolve, ANDROID_REMOTE_FILE_POLL_MS));
  }
}

async function copyAndroidRecordingWithValidation(params: {
  deps: RecordTraceDeps;
  deviceId: string;
  remotePath: string;
  outPath: string;
}): Promise<string | undefined> {
  const { deps, deviceId, remotePath, outPath } = params;
  let lastCopyError: string | undefined;

  for (let attempt = 0; attempt < ANDROID_LOCAL_VIDEO_ATTEMPTS; attempt += 1) {
    try {
      fs.rmSync(outPath, { force: true });
    } catch {
      // Ignore stale local file cleanup issues and let adb pull report the real failure.
    }

    const pullResult = await deps.runCmd('adb', ['-s', deviceId, 'pull', remotePath, outPath], {
      allowFailure: true,
    });
    if (pullResult.exitCode !== 0) {
      lastCopyError = failedExecMessage(pullResult, 'adb pull');
    } else {
      await deps.waitForStableFile(outPath, {
        pollMs: ANDROID_REMOTE_FILE_POLL_MS,
        attempts: ANDROID_REMOTE_FILE_ATTEMPTS,
      });
      const playable = await deps.isPlayableVideo(outPath);
      const atoms = inspectMp4TopLevelAtoms(outPath);
      emitDiagnostic({
        level: 'debug',
        phase: 'record_stop_android_pull_validation',
        data: {
          deviceId,
          remotePath,
          outPath,
          attempt: attempt + 1,
          fileSize: (() => {
            try {
              return fs.statSync(outPath).size;
            } catch {
              return 0;
            }
          })(),
          atoms,
          playable,
        },
      });
      if (playable) {
        return undefined;
      }

      emitDiagnostic({
        level: 'warn',
        phase: 'record_stop_android_invalid_video_retry',
        data: {
          deviceId,
          remotePath,
          outPath,
          attempt: attempt + 1,
        },
      });
    }

    if (attempt < ANDROID_LOCAL_VIDEO_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, ANDROID_LOCAL_VIDEO_POLL_MS));
    }
  }

  if (lastCopyError) {
    return `failed to copy recording from device: ${lastCopyError}`;
  }
  return 'failed to copy recording from device: pulled file is not a playable MP4';
}

export async function startAndroidRecording(params: {
  deps: RecordTraceDeps;
  device: AndroidDevice;
  recordingBase: AndroidRecordingBase;
}): Promise<DaemonResponse | AndroidRecording> {
  const { deps, device, recordingBase } = params;

  const remotePath = `/sdcard/agent-device-recording-${Date.now()}.mp4`;
  const startResult = await deps.runCmd(
    'adb',
    ['-s', device.id, 'shell', `screenrecord ${remotePath} >/dev/null 2>&1 & echo $!`],
    {
      allowFailure: true,
    },
  );
  if (startResult.exitCode !== 0) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: `failed to start recording: ${failedExecMessage(startResult, 'adb shell screenrecord')}`,
      },
    };
  }

  const remotePid = parseAndroidRemotePid(startResult.stdout);
  if (!remotePid) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'failed to start recording: adb did not return a valid Android screenrecord pid',
      },
    };
  }

  emitDiagnostic({
    level: 'debug',
    phase: 'record_start_android_started',
    data: {
      deviceId: device.id,
      remotePath,
      remotePid,
    },
  });

  return {
    platform: 'android',
    remotePath,
    remotePid,
    ...recordingBase,
  };
}

export async function stopAndroidRecording(params: {
  deps: RecordTraceDeps;
  device: AndroidDevice;
  recording: AndroidRecording;
}): Promise<DaemonResponse | null> {
  const { deps, device, recording } = params;
  emitDiagnostic({
    level: 'debug',
    phase: 'record_stop_android_enter',
    data: {
      deviceId: device.id,
      remotePath: recording.remotePath,
      remotePid: recording.remotePid,
    },
  });
  let stopError: string | undefined;
  let copyError: string | undefined;
  let cleanupError: string | undefined;
  let overlayError: string | undefined;

  const stopResult = await deps.runCmd(
    'adb',
    ['-s', device.id, 'shell', 'kill', '-2', recording.remotePid],
    {
      allowFailure: true,
    },
  );
  emitDiagnostic({
    level: 'debug',
    phase: 'record_stop_android_signal',
    data: {
      deviceId: device.id,
      remotePath: recording.remotePath,
      remotePid: recording.remotePid,
      exitCode: stopResult.exitCode,
      stdout: stopResult.stdout.trim(),
      stderr: stopResult.stderr.trim(),
    },
  });
  if (stopResult.exitCode !== 0) {
    if (await isAndroidProcessRunning(deps, device.id, recording.remotePid)) {
      stopError = `failed to stop recording: ${failedExecMessage(stopResult, 'adb shell kill')}`;
    }
  } else if (!(await waitForAndroidProcessExit(deps, device.id, recording.remotePid))) {
    stopError = `failed to stop recording: Android screenrecord pid ${recording.remotePid} did not exit`;
  }

  if (!stopError) {
    await waitForAndroidRemoteFileStability(deps, device.id, recording.remotePath);
    copyError = await copyAndroidRecordingWithValidation({
      deps,
      deviceId: device.id,
      remotePath: recording.remotePath,
      outPath: recording.outPath,
    });
    if (!copyError && recording.showTouches) {
      try {
        await deps.overlayRecordingTouches({
          videoPath: recording.outPath,
          events: recording.gestureEvents,
          targetLabel: 'Android recording',
        });
      } catch (error) {
        overlayError = `failed to overlay recording touches: ${errorMessage(error)}`;
      }
    }

    const rmResult = await deps.runCmd(
      'adb',
      ['-s', device.id, 'shell', 'rm', '-f', recording.remotePath],
      {
        allowFailure: true,
      },
    );
    emitDiagnostic({
      level: 'debug',
      phase: 'record_stop_android_cleanup',
      data: {
        deviceId: device.id,
        remotePath: recording.remotePath,
        exitCode: rmResult.exitCode,
        stdout: rmResult.stdout.trim(),
        stderr: rmResult.stderr.trim(),
      },
    });
    if (rmResult.exitCode !== 0) {
      cleanupError = `failed to clean up remote recording: ${failedExecMessage(rmResult, 'adb shell rm')}`;
    }
  }

  if (stopError) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: stopError,
      },
    };
  }

  if (copyError) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: copyError,
      },
    };
  }

  if (overlayError) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: overlayError,
      },
    };
  }

  if (cleanupError) {
    return {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: cleanupError,
      },
    };
  }

  return null;
}
