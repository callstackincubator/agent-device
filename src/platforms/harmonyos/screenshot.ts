import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runHarmonyHdc } from './hdc.ts';

export async function screenshotHarmony(device: DeviceInfo, outPath: string): Promise<void> {
  const uuid = randomUUID();
  const remotePath = `/data/local/tmp/hd-screen-${uuid}.jpeg`;

  // Step 1: Capture screenshot on device
  const captureResult = await runHarmonyHdc(
    device,
    ['shell', 'snapshot_display', '-f', remotePath],
    { allowFailure: false, timeoutMs: 15_000 },
  );

  if (captureResult.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `snapshot_display failed: ${captureResult.stderr}`);
  }

  // Step 2: Pull to local
  await runHarmonyHdc(device, ['file', 'recv', remotePath, outPath], {
    allowFailure: false,
    timeoutMs: 15_000,
  });

  // Step 3: Cleanup remote file
  await runHarmonyHdc(device, ['shell', 'rm', '-f', remotePath], {
    allowFailure: true,
  });

  // Verify JPEG signature
  const buffer = await fs.readFile(outPath);
  if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
    throw new AppError('COMMAND_FAILED', 'Screenshot data is not a valid JPEG');
  }
}
