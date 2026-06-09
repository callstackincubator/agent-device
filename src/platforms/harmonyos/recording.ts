import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runHarmonyHdc } from './hdc.ts';

const HARMONY_PROCESS_EXIT_POLL_MS = 250;
const HARMONY_PROCESS_EXIT_ATTEMPTS = 40;

export async function startHarmonyRecording(
  device: DeviceInfo,
  remotePath: string,
): Promise<{ remotePid: string }> {
  const shellCmd = `screenrecord --output ${remotePath} >/dev/null 2>&1 & echo $!`;
  const result = await runHarmonyHdc(device, ['shell', shellCmd], { allowFailure: true });

  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `Failed to start HarmonyOS recording: ${result.stderr}`);
  }

  const remotePid = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line))
    .at(-1);

  if (!remotePid) {
    throw new AppError('COMMAND_FAILED', 'Failed to get HarmonyOS screenrecord PID');
  }

  return { remotePid };
}

export async function stopHarmonyRecording(params: {
  device: DeviceInfo;
  remotePid: string;
  remotePath: string;
  localPath: string;
}): Promise<void> {
  const { device, remotePid, remotePath, localPath } = params;

  // Send SIGINT to gracefully stop screenrecord
  await runHarmonyHdc(device, ['shell', 'kill', '-2', remotePid], { allowFailure: true });

  // Wait for process to exit
  await waitForHarmonyProcessExit(device, remotePid);

  // Pull the recording file
  try {
    await runHarmonyHdc(device, ['file', 'recv', remotePath, localPath], {
      allowFailure: false,
      timeoutMs: 30_000,
    });
  } catch {
    throw new AppError('COMMAND_FAILED', 'Failed to retrieve HarmonyOS recording file');
  }

  // Cleanup remote
  await runHarmonyHdc(device, ['shell', 'rm', '-f', remotePath], { allowFailure: true });
}

async function isHarmonyProcessRunning(device: DeviceInfo, pid: string): Promise<boolean> {
  const result = await runHarmonyHdc(device, ['shell', 'ps', '-o', 'pid=', '-p', pid], {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    return false;
  }
  return result.stdout
    .split(/\s+/)
    .map((value) => value.trim())
    .includes(pid);
}

async function waitForHarmonyProcessExit(device: DeviceInfo, pid: string): Promise<void> {
  for (let attempt = 0; attempt < HARMONY_PROCESS_EXIT_ATTEMPTS; attempt += 1) {
    if (!(await isHarmonyProcessRunning(device, pid))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, HARMONY_PROCESS_EXIT_POLL_MS));
  }
}
