import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError, asAppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { Deadline, retryWithPolicy } from '../../utils/retry.ts';
import { classifyBootFailure } from '../boot-diagnostics.ts';

export async function listAndroidDevices(): Promise<DeviceInfo[]> {
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) {
    throw new AppError('TOOL_MISSING', 'adb not found in PATH');
  }

  const result = await runCmd('adb', ['devices', '-l']);
  const lines = result.stdout.split('\n').map((l: string) => l.trim());
  const devices: DeviceInfo[] = [];

  for (const line of lines) {
    if (!line || line.startsWith('List of devices')) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1];
    if (state !== 'device') continue;

    const modelPart = parts.find((p: string) => p.startsWith('model:')) ?? '';
    const rawModel = modelPart.replace('model:', '').replace(/_/g, ' ').trim();
    let name = rawModel || serial;

    if (serial.startsWith('emulator-')) {
      const avd = await runCmd('adb', ['-s', serial, 'emu', 'avd', 'name'], {
        allowFailure: true,
      });
      const avdName = (avd.stdout as string).trim();
      if (avd.exitCode === 0 && avdName) {
        name = avdName.replace(/_/g, ' ');
      }
    }

    const booted = await isAndroidBooted(serial);

    devices.push({
      platform: 'android',
      id: serial,
      name,
      kind: serial.startsWith('emulator-') ? 'emulator' : 'device',
      booted,
    });
  }

  return devices;
}

export async function isAndroidBooted(serial: string): Promise<boolean> {
  try {
    const result = await runCmd('adb', ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'], {
      allowFailure: true,
    });
    return (result.stdout as string).trim() === '1';
  } catch {
    return false;
  }
}

export async function waitForAndroidBoot(serial: string, timeoutMs = 60000): Promise<void> {
  const deadline = Deadline.fromTimeoutMs(timeoutMs);
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / 1000));
  let lastBootResult: { stdout: string; stderr: string; exitCode: number } | null = null;
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
        const result = await runCmd(
          'adb',
          ['-s', serial, 'shell', 'getprop', 'sys.boot_completed'],
          { allowFailure: true },
        );
        lastBootResult = result;
        if ((result.stdout as string).trim() === '1') return;
        throw new AppError('COMMAND_FAILED', 'Android device is still booting', {
          serial,
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
        });
      },
      {
        maxAttempts,
        baseDelayMs: 1000,
        maxDelayMs: 1000,
        jitter: 0,
        shouldRetry: (error) => {
          const reason = classifyBootFailure({
            error,
            stdout: lastBootResult?.stdout,
            stderr: lastBootResult?.stderr,
          });
          return reason !== 'PERMISSION_DENIED' && reason !== 'TOOL_MISSING' && reason !== 'BOOT_TIMEOUT';
        },
      },
      { deadline },
    );
  } catch (error) {
    const appErr = asAppError(error);
    const reason = classifyBootFailure({
      error,
      stdout: lastBootResult?.stdout,
      stderr: lastBootResult?.stderr,
    });
    const baseDetails = {
      serial,
      timeoutMs,
      elapsedMs: deadline.elapsedMs(),
      reason,
      stdout: lastBootResult?.stdout,
      stderr: lastBootResult?.stderr,
      exitCode: lastBootResult?.exitCode,
    };
    if (timedOut || reason === 'BOOT_TIMEOUT') {
      throw new AppError('COMMAND_FAILED', 'Android device did not finish booting in time', baseDetails);
    }
    if (appErr.code === 'TOOL_MISSING' || reason === 'TOOL_MISSING') {
      throw new AppError('TOOL_MISSING', appErr.message, {
        ...baseDetails,
        ...(appErr.details ?? {}),
      });
    }
    if (reason === 'PERMISSION_DENIED' || reason === 'DEVICE_UNAVAILABLE' || reason === 'DEVICE_OFFLINE') {
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
