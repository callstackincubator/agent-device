import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { adbArgs } from './adb.ts';

export const ANDROID_CPU_SAMPLE_METHOD = 'adb-shell-dumpsys-cpuinfo';
export const ANDROID_CPU_SAMPLE_DESCRIPTION =
  'Aggregated CPU usage for app processes matched from adb shell dumpsys cpuinfo.';
export const ANDROID_MEMORY_SAMPLE_METHOD = 'adb-shell-dumpsys-meminfo';
export const ANDROID_MEMORY_SAMPLE_DESCRIPTION =
  'Memory snapshot from adb shell dumpsys meminfo <package>. Values are reported in kilobytes.';

const ANDROID_PERF_TIMEOUT_MS = 15_000;

export type AndroidCpuPerfSample = {
  usagePercent: number;
  measuredAt: string;
  method: typeof ANDROID_CPU_SAMPLE_METHOD;
  matchedProcesses: string[];
};

export type AndroidMemoryPerfSample = {
  totalPssKb: number;
  totalRssKb?: number;
  measuredAt: string;
  method: typeof ANDROID_MEMORY_SAMPLE_METHOD;
};

export async function sampleAndroidCpuPerf(
  device: DeviceInfo,
  packageName: string,
): Promise<AndroidCpuPerfSample> {
  const measuredAt = new Date().toISOString();
  try {
    const result = await runCmd('adb', adbArgs(device, ['shell', 'dumpsys', 'cpuinfo']), {
      timeoutMs: ANDROID_PERF_TIMEOUT_MS,
    });
    return parseAndroidCpuInfoSample(result.stdout, packageName, measuredAt);
  } catch (error) {
    throw wrapAndroidPerfSamplingError('cpu', packageName, error);
  }
}

export async function sampleAndroidMemoryPerf(
  device: DeviceInfo,
  packageName: string,
): Promise<AndroidMemoryPerfSample> {
  const measuredAt = new Date().toISOString();
  try {
    const result = await runCmd(
      'adb',
      adbArgs(device, ['shell', 'dumpsys', 'meminfo', packageName]),
      { timeoutMs: ANDROID_PERF_TIMEOUT_MS },
    );
    return parseAndroidMemInfoSample(result.stdout, packageName, measuredAt);
  } catch (error) {
    throw wrapAndroidPerfSamplingError('memory', packageName, error);
  }
}

export function parseAndroidCpuInfoSample(
  stdout: string,
  packageName: string,
  measuredAt: string,
): AndroidCpuPerfSample {
  const matchedProcesses: string[] = [];
  let usagePercent = 0;

  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = line.match(/^([0-9]+(?:\.[0-9]+)?)%\s+\d+\/([^\s]+):\s/);
    if (!match) continue;

    const percent = Number(match[1]);
    const processName = match[2];
    if (!Number.isFinite(percent) || !matchesAndroidPackageProcess(processName, packageName)) {
      continue;
    }

    usagePercent += percent;
    if (!matchedProcesses.includes(processName)) {
      matchedProcesses.push(processName);
    }
  }

  return {
    usagePercent: roundPercent(usagePercent),
    measuredAt,
    method: ANDROID_CPU_SAMPLE_METHOD,
    matchedProcesses,
  };
}

export function parseAndroidMemInfoSample(
  stdout: string,
  packageName: string,
  measuredAt: string,
): AndroidMemoryPerfSample {
  if (/no process found for:/i.test(stdout)) {
    throw new AppError(
      'COMMAND_FAILED',
      `Android meminfo did not find a running process for ${packageName}`,
      {
        metric: 'memory',
        package: packageName,
        hint: 'Run open <app> for this session again to ensure the Android app is active, then retry perf.',
      },
    );
  }

  const totalPssKb = matchLabeledNumber(stdout, 'TOTAL PSS') ?? matchTotalRowPss(stdout);
  if (totalPssKb === undefined) {
    throw new AppError(
      'COMMAND_FAILED',
      `Failed to parse Android meminfo output for ${packageName}`,
      {
        metric: 'memory',
        package: packageName,
        hint: 'Retry perf after reopening the app session. If the problem persists, capture adb shell dumpsys meminfo output for debugging.',
      },
    );
  }

  return {
    totalPssKb,
    totalRssKb: matchLabeledNumber(stdout, 'TOTAL RSS'),
    measuredAt,
    method: ANDROID_MEMORY_SAMPLE_METHOD,
  };
}

function wrapAndroidPerfSamplingError(
  metric: 'cpu' | 'memory',
  packageName: string,
  error: unknown,
): AppError {
  if (
    error instanceof AppError &&
    (error.code === 'TOOL_MISSING' || error.code === 'COMMAND_FAILED')
  ) {
    return new AppError(
      error.code,
      `Failed to sample Android ${metric} for ${packageName}`,
      {
        ...(error.details ?? {}),
        metric,
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
    `Failed to sample Android ${metric} for ${packageName}`,
    {
      metric,
      package: packageName,
    },
    error,
  );
}

function matchesAndroidPackageProcess(processName: string, packageName: string): boolean {
  return (
    processName === packageName ||
    processName.startsWith(`${packageName}:`) ||
    processName.startsWith(`${packageName}.`)
  );
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}

function matchLabeledNumber(text: string, label: string): number | undefined {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`${escapedLabel}:\\s*([0-9][0-9,]*)`, 'i'));
  if (!match) return undefined;
  return parseNumericToken(match[1]) ?? undefined;
}

function matchTotalRowPss(text: string): number | undefined {
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!/^TOTAL\b(?!\s+PSS:)/.test(line)) continue;
    const firstValue = line
      .split(/\s+/)
      .slice(1)
      .find((token) => parseNumericToken(token) !== null);
    if (!firstValue) return undefined;
    return parseNumericToken(firstValue) ?? undefined;
  }
  return undefined;
}

function parseNumericToken(token: string): number | null {
  const match = token.replaceAll(',', '').match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}
