import { runCmd, runCmdDetached, whichCmd } from '../../utils/exec.ts';
import type { ExecResult } from '../../utils/exec.ts';
import { AppError, asAppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { Deadline, retryWithPolicy, TIMEOUT_PROFILES } from '../../utils/retry.ts';
import { resolveAndroidSerialAllowlist } from '../../utils/device-isolation.ts';
import { bootFailureHint, classifyBootFailure } from '../boot-diagnostics.ts';

const EMULATOR_SERIAL_PREFIX = 'emulator-';
const ANDROID_BOOT_POLL_MS = 1000;
const ANDROID_EMULATOR_BOOT_POLL_MS = 1000;
const ANDROID_EMULATOR_BOOT_TIMEOUT_MS = 120_000;
const ANDROID_EMULATOR_AVD_NAME_TIMEOUT_MS = 1_500;
const ANDROID_TV_FEATURES = [
  'android.software.leanback',
  'android.software.leanback_only',
  'android.hardware.type.television',
] as const;

type AndroidDeviceDiscoveryOptions = {
  serialAllowlist?: ReadonlySet<string>;
};

function commandOutput(result: ExecResult): string {
  return `${result.stdout}\n${result.stderr}`;
}

function adbArgs(serial: string, args: string[]): string[] {
  return ['-s', serial, ...args];
}

function isEmulatorSerial(serial: string): boolean {
  return serial.startsWith(EMULATOR_SERIAL_PREFIX);
}

function normalizeAndroidName(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
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
  const avdName = await resolveAndroidEmulatorAvdName(serial);
  if (avdName) return avdName.replace(/_/g, ' ');
  return modelName || serial;
}

async function resolveAndroidEmulatorAvdName(serial: string): Promise<string | undefined> {
  const avdPropKeys = ['ro.boot.qemu.avd_name', 'persist.sys.avd_name'];
  for (const prop of avdPropKeys) {
    const result = await runCmd('adb', adbArgs(serial, ['shell', 'getprop', prop]), {
      allowFailure: true,
      timeoutMs: ANDROID_EMULATOR_AVD_NAME_TIMEOUT_MS,
    });
    const value = result.stdout.trim();
    if (result.exitCode === 0 && value.length > 0) {
      return value;
    }
  }
  const emuResult = await runCmd('adb', adbArgs(serial, ['emu', 'avd', 'name']), {
    allowFailure: true,
    timeoutMs: ANDROID_EMULATOR_AVD_NAME_TIMEOUT_MS,
  });
  const emuValue = emuResult.stdout.trim();
  if (emuResult.exitCode === 0 && emuValue.length > 0) {
    return emuValue;
  }
  return undefined;
}

export function parseAndroidTargetFromCharacteristics(rawOutput: string): 'tv' | null {
  const normalized = rawOutput.toLowerCase();
  if (normalized.includes('tv') || normalized.includes('leanback')) {
    return 'tv';
  }
  return null;
}

export function parseAndroidFeatureListForTv(rawOutput: string): boolean {
  return /feature:android\.(software\.leanback(_only)?|hardware\.type\.television)\b/i.test(rawOutput);
}

async function probeAndroidFeature(serial: string, feature: string): Promise<boolean | null> {
  const result = await runCmd(
    'adb',
    adbArgs(serial, ['shell', 'cmd', 'package', 'has-feature', feature]),
    {
      allowFailure: true,
      timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
    },
  );
  const output = commandOutput(result).toLowerCase();
  if (output.includes('true')) return true;
  if (output.includes('false')) return false;
  return null;
}

async function hasAnyAndroidTvFeature(serial: string): Promise<boolean> {
  const featureChecks = await Promise.all(
    ANDROID_TV_FEATURES.map(async (feature) => await probeAndroidFeature(serial, feature)),
  );
  return featureChecks.some((value) => value === true);
}

async function resolveAndroidTarget(serial: string): Promise<'mobile' | 'tv'> {
  const characteristicsResult = await runCmd('adb', adbArgs(serial, ['shell', 'getprop', 'ro.build.characteristics']), {
    allowFailure: true,
    timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
  });
  const characteristicsTarget = parseAndroidTargetFromCharacteristics(commandOutput(characteristicsResult));
  if (characteristicsTarget === 'tv') {
    return 'tv';
  }

  if (await hasAnyAndroidTvFeature(serial)) {
    return 'tv';
  }

  const featureListResult = await runCmd(
    'adb',
    adbArgs(serial, ['shell', 'pm', 'list', 'features']),
    {
      allowFailure: true,
      timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
    },
  );
  if (parseAndroidFeatureListForTv(commandOutput(featureListResult))) {
    return 'tv';
  }

  return 'mobile';
}

export async function listAndroidDevices(options: AndroidDeviceDiscoveryOptions = {}): Promise<DeviceInfo[]> {
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) {
    throw new AppError('TOOL_MISSING', 'adb not found in PATH');
  }
  const serialAllowlist =
    options.serialAllowlist
    ?? resolveAndroidSerialAllowlist(undefined);

  const entries = await listAndroidDeviceEntries();
  const filteredEntries = entries.filter((entry) =>
    !serialAllowlist || serialAllowlist.has(entry.serial));

  const devices = await Promise.all(filteredEntries.map(async ({ serial, rawModel }) => {
    const [name, booted, target] = await Promise.all([
      resolveAndroidDeviceName(serial, rawModel),
      isAndroidBooted(serial),
      resolveAndroidTarget(serial),
    ]);
    return {
      platform: 'android',
      id: serial,
      name,
      kind: isEmulatorSerial(serial) ? 'emulator' : 'device',
      target,
      booted,
    } satisfies DeviceInfo;
  }));

  return devices;
}

type AndroidDeviceEntry = {
  serial: string;
  rawModel: string;
};

function parseAndroidDeviceEntries(rawOutput: string): AndroidDeviceEntry[] {
  const lines = rawOutput.split('\n').map((line) => line.trim());
  return lines
    .filter((line) => line.length > 0 && !line.startsWith('List of devices'))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === 'device')
    .map((parts) => ({
      serial: parts[0],
      rawModel: (parts.find((entry) => entry.startsWith('model:')) ?? '').replace('model:', ''),
    }));
}

async function listAndroidDeviceEntries(): Promise<AndroidDeviceEntry[]> {
  const result = await runCmd('adb', ['devices', '-l'], {
    timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
  });
  return parseAndroidDeviceEntries(result.stdout);
}

export function parseAndroidAvdList(rawOutput: string): string[] {
  return rawOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function resolveAndroidAvdName(avdNames: string[], requestedName: string): string | undefined {
  const direct = avdNames.find((name) => name === requestedName);
  if (direct) return direct;
  const target = normalizeAndroidName(requestedName);
  return avdNames.find((name) => normalizeAndroidName(name) === target);
}

async function listAndroidAvdNames(): Promise<string[]> {
  const result = await runCmd('emulator', ['-list-avds'], {
    allowFailure: true,
    timeoutMs: TIMEOUT_PROFILES.android_boot.operationMs,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to list Android emulator AVDs', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      hint: 'Verify Android emulator tooling is installed and available in PATH.',
    });
  }
  return parseAndroidAvdList(result.stdout);
}

function findAndroidEmulatorByAvdName(
  devices: DeviceInfo[],
  avdName: string,
  serial?: string,
): DeviceInfo | undefined {
  const target = normalizeAndroidName(avdName);
  return devices.find((device) => {
    if (device.platform !== 'android' || device.kind !== 'emulator') return false;
    if (serial && device.id !== serial) return false;
    return normalizeAndroidName(device.name) === target;
  });
}

async function waitForAndroidEmulatorByAvdName(params: {
  avdName: string;
  serial?: string;
  timeoutMs: number;
}): Promise<DeviceInfo> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < params.timeoutMs) {
    try {
      const serial = await findAndroidEmulatorSerialByAvdName(params.avdName, params.serial);
      if (serial) {
        return {
          platform: 'android',
          id: serial,
          name: params.avdName,
          kind: 'emulator',
          target: 'mobile',
          booted: false,
        };
      }
    } catch {
      // Best-effort polling while adb/emulator process settles.
    }
    await new Promise((resolve) => setTimeout(resolve, ANDROID_EMULATOR_BOOT_POLL_MS));
  }
  throw new AppError('COMMAND_FAILED', 'Android emulator did not appear in time', {
    avdName: params.avdName,
    serial: params.serial,
    timeoutMs: params.timeoutMs,
    hint: 'Check emulator logs and verify the AVD can start from command line.',
  });
}

async function findAndroidEmulatorSerialByAvdName(
  avdName: string,
  serial?: string,
): Promise<string | undefined> {
  const target = normalizeAndroidName(avdName);
  const entries = await listAndroidDeviceEntries();
  const candidates = entries.filter((entry) => {
    if (serial && entry.serial !== serial) return false;
    return isEmulatorSerial(entry.serial);
  });

  for (const entry of candidates) {
    if (normalizeAndroidName(entry.rawModel) === target) {
      return entry.serial;
    }
    const resolvedName = await resolveAndroidDeviceName(entry.serial, entry.rawModel);
    if (normalizeAndroidName(resolvedName) === target) {
      return entry.serial;
    }
  }
  return undefined;
}

async function isAndroidBooted(serial: string): Promise<boolean> {
  try {
    const result = await readAndroidBootProp(serial);
    return result.stdout.trim() === '1';
  } catch {
    return false;
  }
}

export async function ensureAndroidEmulatorBooted(params: {
  avdName: string;
  serial?: string;
  timeoutMs?: number;
  headless?: boolean;
}): Promise<DeviceInfo> {
  const requestedAvdName = params.avdName.trim();
  if (!requestedAvdName) {
    throw new AppError('INVALID_ARGS', 'Android emulator boot requires a non-empty AVD name.');
  }
  const timeoutMs = params.timeoutMs ?? ANDROID_EMULATOR_BOOT_TIMEOUT_MS;

  if (!(await whichCmd('adb'))) {
    throw new AppError('TOOL_MISSING', 'adb not found in PATH');
  }
  if (!(await whichCmd('emulator'))) {
    throw new AppError('TOOL_MISSING', 'emulator not found in PATH');
  }

  const avdNames = await listAndroidAvdNames();
  const resolvedAvdName = resolveAndroidAvdName(avdNames, requestedAvdName);
  if (!resolvedAvdName) {
    throw new AppError('DEVICE_NOT_FOUND', `No Android emulator AVD named ${params.avdName}`, {
      requestedAvdName,
      availableAvds: avdNames,
      hint: 'Run `emulator -list-avds` and pass an existing AVD name to --device.',
    });
  }

  const startedAt = Date.now();
  const existing = findAndroidEmulatorByAvdName(await listAndroidDevices(), resolvedAvdName, params.serial);
  if (!existing) {
    const launchArgs = ['-avd', resolvedAvdName];
    if (params.headless) {
      launchArgs.push('-no-window', '-no-audio');
    }
    runCmdDetached('emulator', launchArgs);
  }

  const discovered =
    existing
    ?? (await waitForAndroidEmulatorByAvdName({
      avdName: resolvedAvdName,
      serial: params.serial,
      timeoutMs,
    }));

  const elapsedMs = Date.now() - startedAt;
  const remainingMs = Math.max(1_000, timeoutMs - elapsedMs);
  await waitForAndroidBoot(discovered.id, remainingMs);
  const refreshed = (await listAndroidDevices()).find((device) => device.id === discovered.id);
  if (refreshed) {
    return {
      ...refreshed,
      name: resolvedAvdName,
      booted: true,
    };
  }
  return {
    ...discovered,
    name: resolvedAvdName,
    booted: true,
  };
}

export async function ensureAndroidEmulatorHeadlessBooted(params: {
  avdName: string;
  serial?: string;
  timeoutMs?: number;
}): Promise<DeviceInfo> {
  return await ensureAndroidEmulatorBooted({
    ...params,
    headless: true,
  });
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
