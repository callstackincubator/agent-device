import { runCmd, whichCmd } from '../../utils/exec.ts';
import type { ExecResult } from '../../utils/exec.ts';
import { AppError, asAppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { Deadline, isEnvTruthy, retryWithPolicy, TIMEOUT_PROFILES, type RetryTelemetryEvent } from '../../utils/retry.ts';
import { bootFailureHint, classifyBootFailure } from '../boot-diagnostics.ts';

const EMULATOR_SERIAL_PREFIX = 'emulator-';
const ANDROID_BOOT_POLL_MS = 1000;
const RETRY_LOGS_ENABLED = isEnvTruthy(process.env.AGENT_DEVICE_RETRY_LOGS);

function adbArgs(serial: string, args: string[]): string[] {
  return ['-s', serial, ...args];
}

function isEmulatorSerial(serial: string): boolean {
  return serial.startsWith(EMULATOR_SERIAL_PREFIX);
}

async function readAndroidBootProp(
  serial: string,
  timeoutMs = TIMEOUT_PROFILES.android_boot.operationMs,
): Promise<ExecResult> {
  return runCmd('adb', adbArgs(serial, ['shell', 'getprop', 'sys.boot_completed']), {
    allowFailure: true,
    timeoutMs,
  });
}

async function resolveAndroidDeviceName(serial: string, rawModel: string): Promise<string> {
  const modelName = rawModel.replace(/_/g, ' ').trim();
  if (!isEmulatorSerial(serial)) return modelName || serial;
  const avd = await runCmd('adb', adbArgs(serial, ['emu', 'avd', 'name']), {
    allowFailure: true,
    timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
  });
  const avdName = avd.stdout.trim();
  if (avd.exitCode === 0 && avdName) {
    return avdName.replace(/_/g, ' ');
  }
  return modelName || serial;
}

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) {
    throw new AppError('TOOL_MISSING', 'adb not found in PATH');
  }

  const result = await runCmd('adb', ['devices', '-l'], {
    timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
  });
  const lines = result.stdout.split('\n').map((l: string) => l.trim());
  const entries = lines
    .filter((line) => line.length > 0 && !line.startsWith('List of devices'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => ({
      serial: parts[0],
      rawModel: (parts.find((p: string) => p.startsWith('model:')) ?? '').replace('model:', ''),
    }));

  const devices = await Promise.all(entries.map(async ({ serial, rawModel }) => {
    const [name, booted] = await Promise.all([
      resolveAndroidDeviceName(serial, rawModel),
      isAndroidBooted(serial),
    ]);
    return {
      platform: 'android',
      id: serial,
      name,
      kind: isEmulatorSerial(serial) ? 'emulator' : 'device',
      booted,
    } satisfies DeviceInfo;
  }));

  return devices;
}

export async function isAndroidBooted(serial: string): Promise<boolean> {
  try {
    const result = await readAndroidBootProp(serial);
    return result.stdout.trim() === '1';
  } catch {
    return false;
  }
}

export async function waitForAndroidBoot(serial: string, timeoutMs = 60000): Promise<void> {
  const timeoutBudget = timeoutMs;
  const deadline = Deadline.fromTimeoutMs(timeoutBudget);
  const maxAttempts = Math.max(1, Math.ceil(timeoutBudget / ANDROID_BOOT_POLL_MS));
  let lastBootResult: ExecResult | undefined;
  let timedOut = false;
  try {
    await retryWithPolicy(
      async ({ deadline: attemptDeadline }) => {
        if (attemptDeadline?.isExpired()) {
          timedOut = true;
          throw new AppError('COMMAND_FAILED', 'Android boot deadline exceeded', {
            serial,
            timeoutMs,
            elapsedMs: deadline.elapsedMs(),
            message: 'timeout',
          });
        }
        const remainingMs = Math.max(1_000, attemptDeadline?.remainingMs() ?? timeoutBudget);
        const result = await readAndroidBootProp(
          serial,
          Math.min(remainingMs, TIMEOUT_PROFILES.android_boot.operationMs),
        );
        lastBootResult = result;
        if (result.stdout.trim() === '1') return;
        throw new AppError('COMMAND_FAILED', 'Android device is still booting', {
          serial,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      },
      {
        maxAttempts,
        baseDelayMs: ANDROID_BOOT_POLL_MS,
        maxDelayMs: ANDROID_BOOT_POLL_MS,
        jitter: 0,
        shouldRetry: (error) => {
          const reason = classifyBootFailure({
            error,
            stdout: lastBootResult?.stdout,
            stderr: lastBootResult?.stderr,
            context: { platform: 'android', phase: 'boot' },
          });
          return reason !== 'ADB_TRANSPORT_UNAVAILABLE' && reason !== 'ANDROID_BOOT_TIMEOUT';
        },
      },
      {
        deadline,
        phase: 'boot',
        classifyReason: (error) =>
          classifyBootFailure({
            error,
            stdout: lastBootResult?.stdout,
            stderr: lastBootResult?.stderr,
            context: { platform: 'android', phase: 'boot' },
          }),
        onEvent: (event: RetryTelemetryEvent) => {
          if (!RETRY_LOGS_ENABLED) return;
          process.stderr.write(`[agent-device][retry] ${JSON.stringify(event)}\n`);
        },
      },
    );
  } catch (error) {
    const appErr = asAppError(error);
    const stdout = lastBootResult?.stdout;
    const stderr = lastBootResult?.stderr;
    const exitCode = lastBootResult?.exitCode;
    let reason = classifyBootFailure({
      error,
      stdout,
      stderr,
      context: { platform: 'android', phase: 'boot' },
    });
    if (reason === 'BOOT_COMMAND_FAILED' && appErr.message === 'Android device is still booting') {
      reason = 'ANDROID_BOOT_TIMEOUT';
    }
    const baseDetails = {
      serial,
      timeoutMs: timeoutBudget,
      elapsedMs: deadline.elapsedMs(),
      reason,
      hint: bootFailureHint(reason),
      stdout,
      stderr,
      exitCode,
    };
    if (timedOut || reason === 'ANDROID_BOOT_TIMEOUT') {
      throw new AppError('COMMAND_FAILED', 'Android device did not finish booting in time', baseDetails);
    }
    if (appErr.code === 'TOOL_MISSING') {
      throw new AppError('TOOL_MISSING', appErr.message, {
        ...baseDetails,
        ...(appErr.details ?? {}),
      });
    }
    if (reason === 'ADB_TRANSPORT_UNAVAILABLE') {
      throw new AppError('COMMAND_FAILED', appErr.message, {
        ...baseDetails,
        ...(appErr.details ?? {}),
      });
    }
    throw new AppError(appErr.code, appErr.message, {
      ...baseDetails,
      ...(appErr.details ?? {}),
    }, appErr.cause);
  }
}
