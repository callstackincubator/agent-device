import path from 'node:path';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { uniqueStrings } from '../../daemon/action-utils.ts';
import { readInfoPlistString } from './plist.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';

export const APPLE_CPU_SAMPLE_METHOD = 'ps-process-snapshot';
export const APPLE_MEMORY_SAMPLE_METHOD = 'ps-process-snapshot';
export const APPLE_DEVICE_PERF_UNAVAILABLE_REASON =
  'CPU and memory sampling are not yet implemented for physical iOS devices.';

const APPLE_PERF_TIMEOUT_MS = 15_000;

export type AppleCpuPerfSample = {
  usagePercent: number;
  measuredAt: string;
  method: typeof APPLE_CPU_SAMPLE_METHOD;
  matchedProcesses: string[];
};

export type AppleMemoryPerfSample = {
  residentMemoryKb: number;
  measuredAt: string;
  method: typeof APPLE_MEMORY_SAMPLE_METHOD;
  matchedProcesses: string[];
};

type AppleProcessSample = {
  pid: number;
  cpuPercent: number;
  rssKb: number;
  command: string;
};

export async function sampleApplePerfMetrics(
  device: DeviceInfo,
  appBundleId: string,
): Promise<{ cpu: AppleCpuPerfSample; memory: AppleMemoryPerfSample }> {
  if (device.platform === 'ios' && device.kind === 'device') {
    throw new AppError('UNSUPPORTED_OPERATION', APPLE_DEVICE_PERF_UNAVAILABLE_REASON, {
      platform: device.platform,
      deviceKind: device.kind,
      appBundleId,
      hint: 'Use an iOS simulator or macOS app session for CPU/memory perf sampling for now.',
    });
  }

  const executable = await resolveAppleExecutable(device, appBundleId);
  const processes = await readAppleProcessSamples(device, executable);
  if (processes.length === 0) {
    throw new AppError('COMMAND_FAILED', `No running process found for ${appBundleId}`, {
      appBundleId,
      hint: 'Run open <app> for this session again to ensure the Apple app is active, then retry perf.',
    });
  }

  const measuredAt = new Date().toISOString();
  const matchedProcesses = uniqueStrings(
    processes.map((process) => path.basename(readProcessCommandToken(process.command))),
  );
  return {
    cpu: {
      usagePercent: roundPercent(
        processes.reduce((total, process) => total + process.cpuPercent, 0),
      ),
      measuredAt,
      method: APPLE_CPU_SAMPLE_METHOD,
      matchedProcesses,
    },
    memory: {
      residentMemoryKb: Math.round(processes.reduce((total, process) => total + process.rssKb, 0)),
      measuredAt,
      method: APPLE_MEMORY_SAMPLE_METHOD,
      matchedProcesses,
    },
  };
}

export function buildAppleSamplingMetadata(device: DeviceInfo): Record<string, unknown> {
  if (device.platform === 'ios' && device.kind === 'device') {
    return {
      memory: {
        method: APPLE_MEMORY_SAMPLE_METHOD,
        description: APPLE_DEVICE_PERF_UNAVAILABLE_REASON,
        unit: 'kB',
      },
      cpu: {
        method: APPLE_CPU_SAMPLE_METHOD,
        description: APPLE_DEVICE_PERF_UNAVAILABLE_REASON,
        unit: 'percent',
      },
    };
  }

  const source =
    device.platform === 'macos'
      ? 'host ps for the running macOS app executable resolved from the bundle ID.'
      : 'xcrun simctl spawn ps for the running iOS simulator app executable resolved from the bundle ID.';
  return {
    memory: {
      method: APPLE_MEMORY_SAMPLE_METHOD,
      description: `Resident memory snapshot from ${source}`,
      unit: 'kB',
    },
    cpu: {
      method: APPLE_CPU_SAMPLE_METHOD,
      description: `Recent CPU usage snapshot from ${source}`,
      unit: 'percent',
    },
  };
}

export function parseApplePsOutput(stdout: string): AppleProcessSample[] {
  const rows: AppleProcessSample[] = [];
  for (const rawLine of stdout.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = line.match(/^(\d+)\s+([0-9]+(?:\.[0-9]+)?)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const cpuPercent = Number(match[2]);
    const rssKb = Number(match[3]);
    const command = match[4].trim();
    if (!Number.isFinite(pid) || !Number.isFinite(cpuPercent) || !Number.isFinite(rssKb)) {
      continue;
    }
    rows.push({ pid, cpuPercent, rssKb, command });
  }
  return rows;
}

async function resolveAppleExecutable(
  device: DeviceInfo,
  appBundleId: string,
): Promise<{ executableName: string; executablePath?: string }> {
  const appPath =
    device.platform === 'macos'
      ? await resolveMacOsBundlePath(appBundleId)
      : await resolveIosSimulatorAppContainer(device, appBundleId);
  const infoPlistPath =
    device.platform === 'macos'
      ? path.join(appPath, 'Contents', 'Info.plist')
      : path.join(appPath, 'Info.plist');
  const executableName = await readInfoPlistString(infoPlistPath, 'CFBundleExecutable');
  if (!executableName) {
    throw new AppError('COMMAND_FAILED', `Failed to resolve executable for ${appBundleId}`, {
      appBundleId,
      appPath,
    });
  }

  return {
    executableName,
    executablePath:
      device.platform === 'macos'
        ? path.join(appPath, 'Contents', 'MacOS', executableName)
        : undefined,
  };
}

async function resolveMacOsBundlePath(appBundleId: string): Promise<string> {
  const query = `kMDItemCFBundleIdentifier == "${appBundleId.replaceAll('"', '\\"')}"`;
  const result = await runCmd('mdfind', [query], {
    allowFailure: true,
    timeoutMs: APPLE_PERF_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `Failed to resolve macOS app bundle for ${appBundleId}`, {
      appBundleId,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }

  const bundlePath = result.stdout
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.endsWith('.app'));
  if (!bundlePath) {
    throw new AppError('APP_NOT_INSTALLED', `No macOS app found for ${appBundleId}`, {
      appBundleId,
    });
  }
  return bundlePath;
}

async function resolveIosSimulatorAppContainer(
  device: DeviceInfo,
  appBundleId: string,
): Promise<string> {
  const args = buildSimctlArgsForDevice(device, [
    'get_app_container',
    device.id,
    appBundleId,
    'app',
  ]);
  const result = await runCmd('xcrun', args, {
    allowFailure: true,
    timeoutMs: APPLE_PERF_TIMEOUT_MS,
  });
  if (result.exitCode !== 0) {
    throw new AppError(
      'COMMAND_FAILED',
      `Failed to resolve iOS simulator app container for ${appBundleId}`,
      {
        appBundleId,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        hint: 'Ensure the iOS simulator app is installed and booted, then retry perf.',
      },
    );
  }
  const appPath = result.stdout.trim();
  if (appPath.length === 0) {
    throw new AppError(
      'APP_NOT_INSTALLED',
      `No iOS simulator app container found for ${appBundleId}`,
      {
        appBundleId,
      },
    );
  }
  return appPath;
}

async function readAppleProcessSamples(
  device: DeviceInfo,
  executable: { executableName: string; executablePath?: string },
): Promise<AppleProcessSample[]> {
  const args =
    device.platform === 'macos'
      ? ['-axo', 'pid=,%cpu=,rss=,command=']
      : buildSimctlArgsForDevice(device, [
          'spawn',
          device.id,
          'ps',
          '-axo',
          'pid=,%cpu=,rss=,command=',
        ]);
  const result = await runCmd(device.platform === 'macos' ? 'ps' : 'xcrun', args, {
    timeoutMs: APPLE_PERF_TIMEOUT_MS,
  });
  return parseApplePsOutput(result.stdout).filter((process) =>
    matchesAppleExecutableProcess(process.command, executable),
  );
}

function matchesAppleExecutableProcess(
  command: string,
  executable: { executableName: string; executablePath?: string },
): boolean {
  const token = readProcessCommandToken(command);
  if (
    executable.executablePath &&
    (token === executable.executablePath || command.startsWith(`${executable.executablePath} `))
  ) {
    return true;
  }
  return path.basename(token) === executable.executableName;
}

function readProcessCommandToken(command: string): string {
  const [token = ''] = command.trim().split(/\s+/, 1);
  return token;
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}
