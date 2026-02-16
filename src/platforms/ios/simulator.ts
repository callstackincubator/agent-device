import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { Deadline, retryWithPolicy, type RetryTelemetryEvent } from '../../utils/retry.ts';
import { bootFailureHint, classifyBootFailure } from '../boot-diagnostics.ts';

import { IOS_BOOT_TIMEOUT_MS, IOS_SIMCTL_LIST_TIMEOUT_MS, RETRY_LOGS_ENABLED } from './config.ts';

export function ensureSimulator(device: DeviceInfo, command: string): void {
  if (device.kind !== 'simulator') {
    throw new AppError('UNSUPPORTED_OPERATION', `${command} is only supported on iOS simulators`);
  }
}

export async function ensureBootedSimulator(device: DeviceInfo): Promise<void> {
  if (device.kind !== 'simulator') return;

  const state = await getSimulatorState(device.id);
  if (state === 'Booted') return;

  const deadline = Deadline.fromTimeoutMs(IOS_BOOT_TIMEOUT_MS);
  let bootResult:
    | {
      stdout: string;
      stderr: string;
      exitCode: number;
    }
    | undefined;
  let bootStatusResult:
    | {
      stdout: string;
      stderr: string;
      exitCode: number;
    }
    | undefined;

  try {
    await retryWithPolicy(
      async ({ deadline: attemptDeadline }) => {
        if (attemptDeadline?.isExpired()) {
          throw new AppError('COMMAND_FAILED', 'iOS simulator boot deadline exceeded', {
            timeoutMs: IOS_BOOT_TIMEOUT_MS,
          });
        }

        const remainingMs = Math.max(1_000, attemptDeadline?.remainingMs() ?? IOS_BOOT_TIMEOUT_MS);
        const boot = await runCmd('xcrun', ['simctl', 'boot', device.id], {
          allowFailure: true,
          timeoutMs: remainingMs,
        });
        bootResult = {
          stdout: String(boot.stdout ?? ''),
          stderr: String(boot.stderr ?? ''),
          exitCode: boot.exitCode,
        };

        const bootOutput = `${bootResult.stdout}\n${bootResult.stderr}`.toLowerCase();
        const bootAlreadyDone =
          bootOutput.includes('already booted') || bootOutput.includes('current state: booted');

        if (bootResult.exitCode !== 0 && !bootAlreadyDone) {
          throw new AppError('COMMAND_FAILED', 'simctl boot failed', {
            stdout: bootResult.stdout,
            stderr: bootResult.stderr,
            exitCode: bootResult.exitCode,
          });
        }

        const bootStatus = await runCmd('xcrun', ['simctl', 'bootstatus', device.id, '-b'], {
          allowFailure: true,
          timeoutMs: remainingMs,
        });
        bootStatusResult = {
          stdout: String(bootStatus.stdout ?? ''),
          stderr: String(bootStatus.stderr ?? ''),
          exitCode: bootStatus.exitCode,
        };

        if (bootStatusResult.exitCode !== 0) {
          throw new AppError('COMMAND_FAILED', 'simctl bootstatus failed', {
            stdout: bootStatusResult.stdout,
            stderr: bootStatusResult.stderr,
            exitCode: bootStatusResult.exitCode,
          });
        }

        const nextState = await getSimulatorState(device.id);
        if (nextState !== 'Booted') {
          throw new AppError('COMMAND_FAILED', 'Simulator is still booting', { state: nextState });
        }
      },
      {
        maxAttempts: 3,
        baseDelayMs: 500,
        maxDelayMs: 2000,
        jitter: 0.2,
        shouldRetry: (error) => {
          const reason = classifyBootFailure({
            error,
            stdout: bootStatusResult?.stdout ?? bootResult?.stdout,
            stderr: bootStatusResult?.stderr ?? bootResult?.stderr,
            context: { platform: 'ios', phase: 'boot' },
          });
          return reason !== 'IOS_BOOT_TIMEOUT' && reason !== 'CI_RESOURCE_STARVATION_SUSPECTED';
        },
      },
      {
        deadline,
        phase: 'boot',
        classifyReason: (error) =>
          classifyBootFailure({
            error,
            stdout: bootStatusResult?.stdout ?? bootResult?.stdout,
            stderr: bootStatusResult?.stderr ?? bootResult?.stderr,
            context: { platform: 'ios', phase: 'boot' },
          }),
        onEvent: (event: RetryTelemetryEvent) => {
          if (!RETRY_LOGS_ENABLED) return;
          process.stderr.write(`[agent-device][retry] ${JSON.stringify(event)}\n`);
        },
      },
    );
  } catch (error) {
    const reason = classifyBootFailure({
      error,
      stdout: bootStatusResult?.stdout ?? bootResult?.stdout,
      stderr: bootStatusResult?.stderr ?? bootResult?.stderr,
      context: { platform: 'ios', phase: 'boot' },
    });

    throw new AppError('COMMAND_FAILED', 'iOS simulator failed to boot', {
      platform: 'ios',
      deviceId: device.id,
      timeoutMs: IOS_BOOT_TIMEOUT_MS,
      elapsedMs: deadline.elapsedMs(),
      reason,
      hint: bootFailureHint(reason),
      boot: bootResult,
      bootstatus: bootStatusResult,
    });
  }
}

export async function getSimulatorState(udid: string): Promise<string | null> {
  const result = await runCmd('xcrun', ['simctl', 'list', 'devices', '-j'], {
    allowFailure: true,
    timeoutMs: IOS_SIMCTL_LIST_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) return null;

  try {
    const payload = JSON.parse(String(result.stdout ?? '')) as {
      devices: Record<string, { udid: string; state: string }[]>;
    };

    for (const runtime of Object.values(payload.devices ?? {})) {
      const match = runtime.find((entry) => entry.udid === udid);
      if (match) return match.state;
    }
    return null;
  } catch {
    return null;
  }
}
