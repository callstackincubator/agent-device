import fs from 'node:fs';
import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { DaemonResponse, SessionState } from '../types.ts';
import { formatRecordTraceExecFailure } from '../record-trace-errors.ts';
import type { RecordTraceDeps } from './record-trace-types.ts';
import { finalizeRecordingOverlay } from './record-trace-finalize.ts';
import { errorResponse } from './response.ts';

const ANDROID_REMOTE_FILE_POLL_MS = 250;
const ANDROID_REMOTE_FILE_ATTEMPTS = 20;
const ANDROID_REMOTE_FILE_STABLE_POLLS = 4;
const ANDROID_LOCAL_VIDEO_ATTEMPTS = 2;
const ANDROID_LOCAL_VIDEO_RETRY_DELAY_MS = 750;
const ANDROID_PROCESS_EXIT_POLL_MS = 250;
const ANDROID_PROCESS_EXIT_ATTEMPTS = 40;
const ANDROID_RECORDING_READY_ATTEMPTS = 8;
const ANDROID_RECORDING_READY_MIN_RUNNING_POLLS = 2;

type AndroidDevice = SessionState['device'];
type AndroidRecording = Extract<NonNullable<SessionState['recording']>, { platform: 'android' }>;
type AndroidRecordingBase = Pick<
  AndroidRecording,
  | 'outPath'
  | 'clientOutPath'
  | 'telemetryPath'
  | 'startedAt'
  | 'quality'
  | 'showTouches'
  | 'gestureEvents'
>;

function parseAndroidRemotePid(stdout: string): string | undefined {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .at(-1);
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
      if (stableCount >= ANDROID_REMOTE_FILE_STABLE_POLLS) {
        return;
      }
    } else {
      stableCount = 0;
    }
    previousSize = currentSize;
    await new Promise((resolve) => setTimeout(resolve, ANDROID_REMOTE_FILE_POLL_MS));
  }
}

async function waitForAndroidRecordingReady(
  deps: RecordTraceDeps,
  deviceId: string,
  remotePath: string,
  remotePid: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < ANDROID_RECORDING_READY_ATTEMPTS; attempt += 1) {
    const statResult = await deps.runCmd(
      'adb',
      ['-s', deviceId, 'shell', 'stat', '-c', '%s', remotePath],
      { allowFailure: true },
    );
    const currentSize = statResult.exitCode === 0 ? Number(statResult.stdout.trim()) : NaN;
    if (Number.isFinite(currentSize) && currentSize > 0) {
      return true;
    }

    if (!(await isAndroidProcessRunning(deps, deviceId, remotePid))) {
      return false;
    }

    // Some Android builds keep the output file at zero bytes briefly after screenrecord starts.
    // Once the process stays alive for a couple of polls, treat recording as ready and let stop
    // validation handle final container/playability checks.
    if (attempt + 1 >= ANDROID_RECORDING_READY_MIN_RUNNING_POLLS) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, ANDROID_REMOTE_FILE_POLL_MS));
  }

  return false;
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
      lastCopyError = formatRecordTraceExecFailure(pullResult, 'adb pull');
    } else {
      await deps.waitForStableFile(outPath, {
        pollMs: ANDROID_REMOTE_FILE_POLL_MS,
        attempts: ANDROID_REMOTE_FILE_ATTEMPTS,
      });
      const playable = await deps.isPlayableVideo(outPath);
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
      await new Promise((resolve) => setTimeout(resolve, ANDROID_LOCAL_VIDEO_RETRY_DELAY_MS));
    }
  }

  if (lastCopyError) {
    return `failed to copy recording from device: ${lastCopyError}`;
  }
  return 'failed to copy recording from device: pulled file is not a playable MP4';
}

function androidRemoteRecordingPaths(timestamp: number): string[] {
  const fileName = `agent-device-recording-${timestamp}.mp4`;
  return [`/sdcard/${fileName}`, `/data/local/tmp/${fileName}`];
}

async function resolveAndroidRecordingSize(params: {
  deps: RecordTraceDeps;
  deviceId: string;
  quality: number | undefined;
}): Promise<{ width: number; height: number } | undefined> {
  const { deps, deviceId, quality } = params;
  if (quality === undefined || quality >= 10) {
    return undefined;
  }

  const sizeResult = await deps.runCmd('adb', ['-s', deviceId, 'shell', 'wm', 'size'], {
    allowFailure: true,
  });
  const match =
    sizeResult.stdout.match(/Override size:\s*(\d+)x(\d+)/) ??
    sizeResult.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
  if (sizeResult.exitCode !== 0 || !match) {
    throw new Error(
      `failed to resolve Android screen size for recording quality: ${formatRecordTraceExecFailure(sizeResult, 'adb shell wm size')}`,
    );
  }

  return {
    width: scaledEvenDimension(Number(match[1]), quality),
    height: scaledEvenDimension(Number(match[2]), quality),
  };
}

function scaledEvenDimension(value: number, quality: number): number {
  return Math.max(2, Math.round((value * quality) / 10 / 2) * 2);
}

function buildAndroidScreenrecordCommand(
  remotePath: string,
  size: { width: number; height: number } | undefined,
): string {
  const screenrecordArgs = ['screenrecord'];
  if (size) {
    screenrecordArgs.push('--size', `${size.width}x${size.height}`);
  }
  screenrecordArgs.push(remotePath);
  return `${screenrecordArgs.join(' ')} >/dev/null 2>&1 & echo $!`;
}

async function cleanupAndroidRemoteRecording(
  deps: RecordTraceDeps,
  deviceId: string,
  remotePath: string,
): Promise<void> {
  await deps.runCmd('adb', ['-s', deviceId, 'shell', 'rm', '-f', remotePath], {
    allowFailure: true,
  });
}

async function forceStopAndroidProcess(
  deps: RecordTraceDeps,
  deviceId: string,
  pid: string,
): Promise<boolean> {
  const forceResult = await deps.runCmd('adb', ['-s', deviceId, 'shell', 'kill', '-9', pid], {
    allowFailure: true,
  });
  emitDiagnostic({
    level: 'warn',
    phase: 'record_stop_android_force_signal',
    data: {
      deviceId,
      remotePid: pid,
      exitCode: forceResult.exitCode,
      stdout: forceResult.stdout.trim(),
      stderr: forceResult.stderr.trim(),
    },
  });
  if (forceResult.exitCode !== 0 && (await isAndroidProcessRunning(deps, deviceId, pid))) {
    return false;
  }
  return await waitForAndroidProcessExit(deps, deviceId, pid);
}

export async function startAndroidRecording(params: {
  deps: RecordTraceDeps;
  device: AndroidDevice;
  recordingBase: AndroidRecordingBase;
}): Promise<DaemonResponse | AndroidRecording> {
  const { deps, device, recordingBase } = params;
  let lastStartError =
    'failed to start recording: Android screenrecord did not begin producing frames';
  let recordingSize: { width: number; height: number } | undefined;
  try {
    recordingSize = await resolveAndroidRecordingSize({
      deps,
      deviceId: device.id,
      quality: recordingBase.quality,
    });
  } catch (error) {
    return errorResponse('COMMAND_FAILED', error instanceof Error ? error.message : String(error));
  }

  for (const remotePath of androidRemoteRecordingPaths(Date.now())) {
    const startResult = await deps.runCmd(
      'adb',
      ['-s', device.id, 'shell', buildAndroidScreenrecordCommand(remotePath, recordingSize)],
      {
        allowFailure: true,
      },
    );
    if (startResult.exitCode !== 0) {
      lastStartError = `failed to start recording: ${formatRecordTraceExecFailure(startResult, 'adb shell screenrecord')}`;
      continue;
    }

    const remotePid = parseAndroidRemotePid(startResult.stdout);
    if (!remotePid) {
      lastStartError =
        'failed to start recording: adb did not return a valid Android screenrecord pid';
      await cleanupAndroidRemoteRecording(deps, device.id, remotePath);
      continue;
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

    if (await waitForAndroidRecordingReady(deps, device.id, remotePath, remotePid)) {
      return {
        platform: 'android',
        remotePath,
        remotePid,
        ...recordingBase,
        startedAt: Date.now(),
      };
    }

    lastStartError =
      'failed to start recording: Android screenrecord did not begin producing frames';
    await forceStopAndroidProcess(deps, device.id, remotePid);
    await cleanupAndroidRemoteRecording(deps, device.id, remotePath);
  }

  return errorResponse('COMMAND_FAILED', lastStartError);
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
  let stopError: string | undefined;
  if (stopResult.exitCode !== 0) {
    if (await isAndroidProcessRunning(deps, device.id, recording.remotePid)) {
      if (!(await forceStopAndroidProcess(deps, device.id, recording.remotePid))) {
        stopError = `failed to stop recording: ${formatRecordTraceExecFailure(stopResult, 'adb shell kill')}`;
      }
    }
  } else if (!(await waitForAndroidProcessExit(deps, device.id, recording.remotePid))) {
    if (!(await forceStopAndroidProcess(deps, device.id, recording.remotePid))) {
      stopError = `failed to stop recording: Android screenrecord pid ${recording.remotePid} did not exit`;
    }
  }
  let cleanupError: string | undefined;

  if (!stopError) {
    await waitForAndroidRemoteFileStability(deps, device.id, recording.remotePath);
    const copyError = await copyAndroidRecordingWithValidation({
      deps,
      deviceId: device.id,
      remotePath: recording.remotePath,
      outPath: recording.outPath,
    });
    if (copyError) {
      await cleanupRemoteRecording();
      return errorResponse('COMMAND_FAILED', copyError);
    }

    await finalizeRecordingOverlay({
      recording,
      deps,
      targetLabel: 'Android recording',
    });
  }

  await cleanupRemoteRecording();

  if (stopError) {
    return errorResponse('COMMAND_FAILED', stopError);
  }

  if (cleanupError) {
    return errorResponse('COMMAND_FAILED', cleanupError);
  }

  return null;

  async function cleanupRemoteRecording(): Promise<void> {
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
    if (rmResult.exitCode !== 0 && !stopError) {
      cleanupError = `failed to clean up remote recording: ${formatRecordTraceExecFailure(rmResult, 'adb shell rm')}`;
    }
  }
}
