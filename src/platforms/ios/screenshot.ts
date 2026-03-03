import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { retryWithPolicy } from '../../utils/retry.ts';

import {
  IOS_SIMULATOR_SCREENSHOT_RETRY_BASE_DELAY_MS,
  IOS_SIMULATOR_SCREENSHOT_RETRY_MAX_ATTEMPTS,
  IOS_SIMULATOR_SCREENSHOT_RETRY_MAX_DELAY_MS,
} from './config.ts';
import { runIosDevicectl } from './devicectl.ts';
import { runIosRunnerCommand, IOS_RUNNER_CONTAINER_BUNDLE_IDS } from './runner-client.ts';
import { ensureBootedSimulator, focusIosSimulatorWindow } from './simulator.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';

function simctlArgs(device: DeviceInfo, args: string[]): string[] {
  return buildSimctlArgsForDevice(device, args);
}

function runSimctl(
  device: DeviceInfo,
  args: string[],
  options?: Parameters<typeof runCmd>[2],
) {
  return runCmd('xcrun', simctlArgs(device, args), options);
}

export async function screenshotIos(device: DeviceInfo, outPath: string, appBundleId?: string): Promise<void> {
  if (device.kind === 'simulator') {
    await ensureBootedSimulator(device);
    await captureSimulatorScreenshotWithRetry(device, outPath);
    return;
  }

  try {
    await runIosDevicectl(['device', 'screenshot', '--device', device.id, outPath], {
      action: 'capture iOS screenshot',
      deviceId: device.id,
    });
    return;
  } catch (error) {
    if (!shouldFallbackToRunnerForIosScreenshot(error)) {
      throw error;
    }
  }

  await captureDeviceScreenshotViaRunner(device, outPath, appBundleId);
}

async function captureSimulatorScreenshotWithRetry(device: DeviceInfo, outPath: string): Promise<void> {
  await focusIosSimulatorWindow();
  await retryWithPolicy(
    async ({ attempt }) => {
      if (attempt > 1) {
        await focusIosSimulatorWindow();
      }
      await runSimctl(device, ['io', device.id, 'screenshot', outPath]);
    },
    {
      maxAttempts: IOS_SIMULATOR_SCREENSHOT_RETRY_MAX_ATTEMPTS,
      baseDelayMs: IOS_SIMULATOR_SCREENSHOT_RETRY_BASE_DELAY_MS,
      maxDelayMs: IOS_SIMULATOR_SCREENSHOT_RETRY_MAX_DELAY_MS,
      jitter: 0.2,
      shouldRetry: (error) => shouldRetryIosSimulatorScreenshot(error),
    },
    { phase: 'ios_simulator_screenshot' },
  );
}

async function captureDeviceScreenshotViaRunner(
  device: DeviceInfo,
  outPath: string,
  appBundleId?: string,
): Promise<void> {
  // `xcrun devicectl device screenshot` is unavailable (removed in Xcode 26.x).
  // Fall back to the XCTest runner: capture to the device's temp directory,
  // then pull the file to the host via `devicectl device copy from`.
  const result = await runIosRunnerCommand(device, { command: 'screenshot', appBundleId });
  const remoteFileName = result['message'] as string;
  if (!remoteFileName) {
    throw new AppError('COMMAND_FAILED', 'Failed to capture iOS screenshot: runner returned no file path');
  }

  let copyResult = { exitCode: 1, stdout: '', stderr: '' };
  for (const bundleId of IOS_RUNNER_CONTAINER_BUNDLE_IDS) {
    copyResult = await runCmd(
      'xcrun',
      [
        'devicectl',
        'device',
        'copy',
        'from',
        '--device',
        device.id,
        '--source',
        remoteFileName,
        '--destination',
        outPath,
        '--domain-type',
        'appDataContainer',
        '--domain-identifier',
        bundleId,
      ],
      { allowFailure: true },
    );
    if (copyResult.exitCode === 0) {
      break;
    }
  }

  if (copyResult.exitCode !== 0) {
    const copyError = copyResult.stderr.trim() || copyResult.stdout.trim() || `devicectl exited with code ${copyResult.exitCode}`;
    throw new AppError('COMMAND_FAILED', `Failed to capture iOS screenshot: ${copyError}`);
  }
}

export function shouldFallbackToRunnerForIosScreenshot(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code !== 'COMMAND_FAILED') return false;
  const details = (error.details ?? {}) as { stdout?: unknown; stderr?: unknown };
  const stdout = typeof details.stdout === 'string' ? details.stdout : '';
  const stderr = typeof details.stderr === 'string' ? details.stderr : '';
  const combined = `${error.message}\n${stdout}\n${stderr}`.toLowerCase();
  return (
    combined.includes("unknown option '--device'") ||
    (combined.includes('unknown subcommand') && combined.includes('screenshot')) ||
    (combined.includes('unrecognized subcommand') && combined.includes('screenshot'))
  );
}

export function shouldRetryIosSimulatorScreenshot(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code !== 'COMMAND_FAILED') return false;
  const details = (error.details ?? {}) as { stdout?: unknown; stderr?: unknown };
  const stdout = typeof details.stdout === 'string' ? details.stdout : '';
  const stderr = typeof details.stderr === 'string' ? details.stderr : '';
  const combined = `${error.message}\n${stdout}\n${stderr}`.toLowerCase();
  return (
    combined.includes('timeout waiting for screen surfaces') ||
    (combined.includes('nsposixerrordomain') && combined.includes('code=60') && combined.includes('screenshot'))
  );
}
