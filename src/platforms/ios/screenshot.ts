import { promises as fs } from 'node:fs';
import path from 'node:path';
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

type SimulatorScreenshotFlowDeps = {
  ensureBooted: (device: DeviceInfo) => Promise<void>;
  captureWithRetry: (device: DeviceInfo, outPath: string) => Promise<void>;
  captureWithRunner: (device: DeviceInfo, outPath: string, appBundleId?: string) => Promise<void>;
  shouldFallbackToRunner: (error: unknown) => boolean;
};

const defaultSimulatorScreenshotFlowDeps: SimulatorScreenshotFlowDeps = {
  ensureBooted: ensureBootedSimulator,
  captureWithRetry: captureSimulatorScreenshotWithRetry,
  captureWithRunner: captureScreenshotViaRunner,
  shouldFallbackToRunner: shouldRetryIosSimulatorScreenshot,
};

export async function screenshotIos(device: DeviceInfo, outPath: string, appBundleId?: string): Promise<void> {
  if (device.kind === 'simulator') {
    await captureSimulatorScreenshotWithFallback(device, outPath, appBundleId);
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

  await captureScreenshotViaRunner(device, outPath, appBundleId);
}

export async function captureSimulatorScreenshotWithFallback(
  device: DeviceInfo,
  outPath: string,
  appBundleId?: string,
  deps: SimulatorScreenshotFlowDeps = defaultSimulatorScreenshotFlowDeps,
): Promise<void> {
  if (device.kind !== 'simulator') {
    throw new AppError('UNSUPPORTED_OPERATION', 'Simulator screenshot fallback flow supports only iOS simulators');
  }

  await deps.ensureBooted(device);
  try {
    await deps.captureWithRetry(device, outPath);
    return;
  } catch (error) {
    if (!deps.shouldFallbackToRunner(error)) {
      throw error;
    }
  }
  await deps.captureWithRunner(device, outPath, appBundleId);
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

async function captureScreenshotViaRunner(
  device: DeviceInfo,
  outPath: string,
  appBundleId?: string,
): Promise<void> {
  // Capture with the XCTest runner, then pull from the runner container.
  // Devices use `devicectl ... copy from`; simulators use `simctl get_app_container`.
  const result = await runIosRunnerCommand(device, { command: 'screenshot', appBundleId });
  const remoteFileName = result['message'] as string;
  if (!remoteFileName) {
    throw new AppError('COMMAND_FAILED', 'Failed to capture iOS screenshot: runner returned no file path');
  }

  if (device.kind === 'simulator') {
    await copyRunnerScreenshotFromSimulator(device, remoteFileName, outPath);
    return;
  }
  await copyRunnerScreenshotFromDevice(device, remoteFileName, outPath);
}

async function copyRunnerScreenshotFromDevice(
  device: DeviceInfo,
  remoteFileName: string,
  outPath: string,
): Promise<void> {
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
      return;
    }
  }
  const copyError = copyResult.stderr.trim() || copyResult.stdout.trim() || `devicectl exited with code ${copyResult.exitCode}`;
  throw new AppError('COMMAND_FAILED', `Failed to capture iOS screenshot: ${copyError}`);
}

async function copyRunnerScreenshotFromSimulator(
  device: DeviceInfo,
  remoteFileName: string,
  outPath: string,
): Promise<void> {
  let lastError = 'Unable to locate runner container for simulator screenshot';
  for (const bundleId of IOS_RUNNER_CONTAINER_BUNDLE_IDS) {
    const containerResult = await runSimctl(device, ['get_app_container', device.id, bundleId, 'data'], {
      allowFailure: true,
    });
    if (containerResult.exitCode !== 0) {
      const stderr = containerResult.stderr.trim();
      if (stderr) {
        lastError = stderr;
      }
      continue;
    }
    const containerPath = containerResult.stdout.trim();
    if (!containerPath) {
      lastError = 'simctl get_app_container returned empty output';
      continue;
    }
    const candidateSourcePaths = resolveSimulatorRunnerScreenshotCandidatePaths(containerPath, remoteFileName);
    for (const sourcePath of candidateSourcePaths) {
      try {
        await fs.copyFile(sourcePath, outPath);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  }
  throw new AppError('COMMAND_FAILED', `Failed to capture iOS screenshot: ${lastError}`);
}

export function resolveSimulatorRunnerScreenshotCandidatePaths(containerPath: string, remoteFileName: string): string[] {
  const normalizedContainerPath = path.resolve(containerPath);
  const rawRemotePath = remoteFileName.trim();
  if (!rawRemotePath) return [];

  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (candidate: string) => {
    const normalized = path.normalize(candidate);
    if (seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const relativeFromRoot = rawRemotePath.replace(/^\/+/, '');
  const remotePosixPath = relativeFromRoot.replace(/\\/g, '/');
  if (relativeFromRoot) {
    pushUnique(path.join(normalizedContainerPath, relativeFromRoot));
  }

  if (path.isAbsolute(rawRemotePath)) {
    pushUnique(path.normalize(rawRemotePath));
  }

  if (remotePosixPath.startsWith('tmp/')) {
    pushUnique(path.join(normalizedContainerPath, remotePosixPath));
  } else {
    const tmpSegmentIndex = remotePosixPath.lastIndexOf('/tmp/');
    if (tmpSegmentIndex >= 0) {
      const fromTmp = remotePosixPath.slice(tmpSegmentIndex + 1);
      pushUnique(path.join(normalizedContainerPath, fromTmp));
    }
  }

  const baseName = path.basename(rawRemotePath);
  if (baseName) {
    pushUnique(path.join(normalizedContainerPath, 'tmp', baseName));
  }

  return candidates;
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
