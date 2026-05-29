import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runHarmonyHdc } from './hdc.ts';

export async function startHarmonyRecording(device: DeviceInfo, remotePath: string): Promise<void> {
  // HarmonyOS screen recording via hdc shell screenrecord
  // This command may not be available on all devices
  await runHarmonyHdc(device, ['shell', 'screenrecord', '--output', remotePath], {
    allowFailure: true,
    timeoutMs: 5_000,
  });
}

export async function stopHarmonyRecording(
  device: DeviceInfo,
  remotePath: string,
  localPath: string,
): Promise<void> {
  // Stop recording (kill the screenrecord process)
  await runHarmonyHdc(device, ['shell', 'aa', 'force-stop', 'com.ohos.screenrecorder'], {
    allowFailure: true,
  });

  // Pull the recording file
  try {
    await runHarmonyHdc(device, ['file', 'recv', remotePath, localPath], {
      allowFailure: false,
      timeoutMs: 30_000,
    });
  } catch {
    throw new AppError('COMMAND_FAILED', 'Failed to retrieve recording file');
  }

  // Cleanup remote
  await runHarmonyHdc(device, ['shell', 'rm', '-f', remotePath], { allowFailure: true });
}
