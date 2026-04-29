import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { adbArgs } from './adb.ts';
import { parseAndroidFramePerfSample, type AndroidFramePerfSample } from './perf-frame-parser.ts';

export {
  ANDROID_FRAME_SAMPLE_DESCRIPTION,
  ANDROID_FRAME_SAMPLE_METHOD,
  parseAndroidFramePerfSample,
  type AndroidFrameDropWindow,
  type AndroidFramePerfSample,
} from './perf-frame-parser.ts';

const ANDROID_FRAME_PERF_TIMEOUT_MS = 15_000;
const ANDROID_FRAME_RESET_TIMEOUT_MS = 3_000;

export async function sampleAndroidFramePerf(
  device: DeviceInfo,
  packageName: string,
): Promise<AndroidFramePerfSample> {
  try {
    const result = await runCmd(
      'adb',
      adbArgs(device, ['shell', 'dumpsys', 'gfxinfo', packageName, 'framestats']),
      { timeoutMs: ANDROID_FRAME_PERF_TIMEOUT_MS },
    );
    const sample = parseAndroidFramePerfSample(
      result.stdout,
      packageName,
      new Date().toISOString(),
    );
    await resetAndroidFramePerfStats(device, packageName);
    return sample;
  } catch (error) {
    throw annotateAndroidFramePerfSamplingError(packageName, error);
  }
}

export async function resetAndroidFramePerfStats(
  device: DeviceInfo,
  packageName: string,
): Promise<void> {
  try {
    await runCmd('adb', adbArgs(device, ['shell', 'dumpsys', 'gfxinfo', packageName, 'reset']), {
      allowFailure: true,
      timeoutMs: ANDROID_FRAME_RESET_TIMEOUT_MS,
    });
  } catch {
    // Reset is best-effort; sampling/open should still succeed if adb times out or disappears.
  }
}

function annotateAndroidFramePerfSamplingError(packageName: string, error: unknown): AppError {
  if (
    error instanceof AppError &&
    (error.code === 'TOOL_MISSING' || error.code === 'COMMAND_FAILED')
  ) {
    return new AppError(
      error.code,
      error.message,
      {
        ...(error.details ?? {}),
        metric: 'fps',
        package: packageName,
      },
      error,
    );
  }

  if (error instanceof AppError) {
    return error;
  }

  return new AppError(
    'COMMAND_FAILED',
    `Failed to sample Android fps for ${packageName}`,
    {
      metric: 'fps',
      package: packageName,
    },
    error,
  );
}
