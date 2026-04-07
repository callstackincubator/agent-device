import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { uniqueStrings } from '../../daemon/action-utils.ts';
import {
  IOS_DEVICECTL_DEFAULT_HINT,
  listIosDeviceApps,
  listIosDeviceProcesses,
  resolveIosDevicectlHint,
  type IosDeviceProcessInfo,
} from './devicectl.ts';
import { readInfoPlistString } from './plist.ts';
import { buildSimctlArgsForDevice } from './simctl.ts';

export const APPLE_CPU_SAMPLE_METHOD = 'ps-process-snapshot';
export const APPLE_MEMORY_SAMPLE_METHOD = 'ps-process-snapshot';
export const IOS_DEVICE_CPU_SAMPLE_METHOD = 'xctrace-activity-monitor';
export const IOS_DEVICE_MEMORY_SAMPLE_METHOD = 'xctrace-activity-monitor';

const APPLE_PERF_TIMEOUT_MS = 15_000;
// Physical device tracing can take materially longer to initialize than the 1s sample window.
const IOS_DEVICE_PERF_RECORD_TIMEOUT_MS = 60_000;
const IOS_DEVICE_PERF_EXPORT_TIMEOUT_MS = 15_000;
const IOS_DEVICE_PERF_TRACE_DURATION = '1s';

export type AppleCpuPerfSample = {
  usagePercent: number;
  measuredAt: string;
  method: typeof APPLE_CPU_SAMPLE_METHOD | typeof IOS_DEVICE_CPU_SAMPLE_METHOD;
  matchedProcesses: string[];
};

export type AppleMemoryPerfSample = {
  residentMemoryKb: number;
  measuredAt: string;
  method: typeof APPLE_MEMORY_SAMPLE_METHOD | typeof IOS_DEVICE_MEMORY_SAMPLE_METHOD;
  matchedProcesses: string[];
};

type AppleProcessSample = {
  pid: number;
  cpuPercent: number;
  rssKb: number;
  command: string;
};

type IosDevicePerfProcessSample = {
  pid: number;
  processName: string;
  cpuTimeNs: number | null;
  residentMemoryBytes: number | null;
};

type ParsedXmlElement = {
  raw: string;
  id?: string;
  ref?: string;
  fmt?: string;
  text: string | null;
};

type IosDevicePerfCapture = {
  capturedAtMs: number;
  xml: string;
};

export async function sampleApplePerfMetrics(
  device: DeviceInfo,
  appBundleId: string,
): Promise<{ cpu: AppleCpuPerfSample; memory: AppleMemoryPerfSample }> {
  if (device.platform === 'ios' && device.kind === 'device') {
    return await sampleIosDevicePerfMetrics(device, appBundleId);
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
  return buildApplePerfSamples({
    usagePercent: processes.reduce((total, process) => total + process.cpuPercent, 0),
    residentMemoryKb: processes.reduce((total, process) => total + process.rssKb, 0),
    measuredAt,
    matchedProcesses,
    cpuMethod: APPLE_CPU_SAMPLE_METHOD,
    memoryMethod: APPLE_MEMORY_SAMPLE_METHOD,
  });
}

export function buildAppleSamplingMetadata(device: DeviceInfo): Record<string, unknown> {
  if (device.platform === 'ios' && device.kind === 'device') {
    return {
      memory: {
        method: IOS_DEVICE_MEMORY_SAMPLE_METHOD,
        description:
          'Resident memory snapshot from a short xctrace Activity Monitor sample on the connected iOS device.',
        unit: 'kB',
      },
      cpu: {
        method: IOS_DEVICE_CPU_SAMPLE_METHOD,
        description:
          'Recent CPU usage snapshot from a short xctrace Activity Monitor sample on the connected iOS device.',
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

export function parseIosDevicePerfTable(xml: string): IosDevicePerfProcessSample[] {
  const schemaMatch = xml.match(
    /<schema name="activity-monitor-process-live">([\s\S]*?)<\/schema>/,
  );
  if (!schemaMatch) {
    throw new AppError(
      'COMMAND_FAILED',
      'Failed to parse xctrace activity-monitor-process-live schema',
    );
  }
  const mnemonics = [...schemaMatch[1].matchAll(/<mnemonic>([^<]+)<\/mnemonic>/g)].map(
    (match) => match[1] ?? '',
  );
  const pidIndex = mnemonics.indexOf('pid');
  const processIndex = mnemonics.indexOf('process');
  const cpuTimeIndex = mnemonics.indexOf('cpu-total');
  const residentMemoryIndex = mnemonics.indexOf('memory-real');
  if (pidIndex < 0 || processIndex < 0 || cpuTimeIndex < 0 || residentMemoryIndex < 0) {
    throw new AppError(
      'COMMAND_FAILED',
      'xctrace activity-monitor-process-live export is missing expected columns',
    );
  }

  const rows = [...xml.matchAll(/<row>([\s\S]*?)<\/row>/g)];
  const samples: IosDevicePerfProcessSample[] = [];
  const references = new Map<
    string,
    {
      numberValue?: number | null;
      processName?: string | null;
    }
  >();
  for (const row of rows) {
    const elements = splitTopLevelXmlElements(row[1] ?? '').map(parseXmlElement);
    if (elements.length === 0) continue;
    for (const element of elements) {
      const nestedPidMatch = element.raw.match(/<pid[^>]*\bid="([^"]+)"[^>]*>([^<]+)<\/pid>/);
      if (nestedPidMatch) {
        const pidValue = Number(nestedPidMatch[2]);
        references.set(nestedPidMatch[1], {
          numberValue: Number.isFinite(pidValue) ? pidValue : null,
        });
      }
      if (!element.id) continue;
      references.set(element.id, {
        numberValue: parseDirectXmlNumber(element),
        processName: readDirectProcessNameFromXml(element),
      });
    }

    const pid = resolveXmlNumber(elements[pidIndex], references);
    const processName = resolveProcessName(elements[processIndex], references);
    if (pid === null || !Number.isFinite(pid) || !processName) continue;
    samples.push({
      pid,
      processName,
      cpuTimeNs: resolveXmlNumber(elements[cpuTimeIndex], references),
      residentMemoryBytes: resolveXmlNumber(elements[residentMemoryIndex], references),
    });
  }
  return samples;
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

async function sampleIosDevicePerfMetrics(
  device: DeviceInfo,
  appBundleId: string,
): Promise<{ cpu: AppleCpuPerfSample; memory: AppleMemoryPerfSample }> {
  const processes = await resolveIosDevicePerfTarget(device, appBundleId);
  const measuredAt = new Date().toISOString();
  const firstCapture = await captureIosDevicePerfTable(device, appBundleId);
  const secondCapture = await captureIosDevicePerfTable(device, appBundleId);
  const firstSnapshot = summarizeIosDevicePerfSnapshot(
    parseIosDevicePerfTable(firstCapture.xml),
    processes,
    appBundleId,
    device,
  );
  const secondSnapshot = summarizeIosDevicePerfSnapshot(
    parseIosDevicePerfTable(secondCapture.xml),
    processes,
    appBundleId,
    device,
  );

  const elapsedMs = secondCapture.capturedAtMs - firstCapture.capturedAtMs;
  if (elapsedMs <= 0) {
    throw new AppError(
      'COMMAND_FAILED',
      `Invalid Activity Monitor sample window for ${appBundleId}`,
      {
        appBundleId,
        deviceId: device.id,
      },
    );
  }
  if (
    firstSnapshot.cpuTimeNs === null ||
    secondSnapshot.cpuTimeNs === null ||
    secondSnapshot.residentMemoryBytes === null
  ) {
    throw new AppError('COMMAND_FAILED', `Incomplete Activity Monitor sample for ${appBundleId}`, {
      appBundleId,
      deviceId: device.id,
      hint: 'Keep the app running in the foreground while perf samples the device, then retry.',
    });
  }

  const cpuDeltaNs = Math.max(0, secondSnapshot.cpuTimeNs - firstSnapshot.cpuTimeNs);
  const usagePercent = (cpuDeltaNs / (elapsedMs * 1_000_000)) * 100;

  return buildApplePerfSamples({
    usagePercent,
    residentMemoryKb: secondSnapshot.residentMemoryBytes / 1024,
    measuredAt,
    matchedProcesses: secondSnapshot.matchedProcesses,
    cpuMethod: IOS_DEVICE_CPU_SAMPLE_METHOD,
    memoryMethod: IOS_DEVICE_MEMORY_SAMPLE_METHOD,
  });
}

async function resolveIosDevicePerfTarget(
  device: DeviceInfo,
  appBundleId: string,
): Promise<IosDeviceProcessInfo[]> {
  const apps = await listIosDeviceApps(device, 'all');
  const app = apps.find((candidate) => candidate.bundleId === appBundleId);
  if (!app) {
    throw new AppError('APP_NOT_INSTALLED', `No iOS device app found for ${appBundleId}`, {
      appBundleId,
      deviceId: device.id,
    });
  }
  if (!app.url) {
    throw new AppError('COMMAND_FAILED', `Missing app bundle URL for ${appBundleId}`, {
      appBundleId,
      deviceId: device.id,
    });
  }

  const appBundleUrl = app.url.replace(/\/$/, '');
  const appBundlePath = fileURLToPath(appBundleUrl);
  const processes = (await listIosDeviceProcesses(device)).filter((process) =>
    process.executable.startsWith(`${appBundleUrl}/`),
  );
  if (processes.length === 0) {
    throw new AppError('COMMAND_FAILED', `No running process found for ${appBundleId}`, {
      appBundleId,
      deviceId: device.id,
      appBundlePath,
      hint: 'Run open <app> for this session again to ensure the iOS app is active, then retry perf.',
    });
  }

  return processes;
}

async function captureIosDevicePerfTable(
  device: DeviceInfo,
  appBundleId: string,
): Promise<IosDevicePerfCapture> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-perf-'));
  const tracePath = path.join(tempDir, 'sample.trace');
  const exportPath = path.join(tempDir, 'activity-monitor-process-live.xml');
  try {
    const recordArgs = [
      'xctrace',
      'record',
      '--template',
      'Activity Monitor',
      '--device',
      device.id,
      '--all-processes',
      '--time-limit',
      IOS_DEVICE_PERF_TRACE_DURATION,
      '--output',
      tracePath,
      '--quiet',
      '--no-prompt',
    ];
    const recordResult = await runCmd('xcrun', recordArgs, {
      allowFailure: true,
      timeoutMs: IOS_DEVICE_PERF_RECORD_TIMEOUT_MS,
    });
    const capturedAtMs = Date.now();
    if (recordResult.exitCode !== 0) {
      throw new AppError(
        'COMMAND_FAILED',
        `Failed to record iOS device Activity Monitor sample for ${appBundleId}`,
        {
          cmd: 'xcrun',
          args: recordArgs,
          exitCode: recordResult.exitCode,
          stdout: recordResult.stdout,
          stderr: recordResult.stderr,
          appBundleId,
          deviceId: device.id,
          hint: resolveIosDevicePerfHint(recordResult.stdout, recordResult.stderr),
        },
      );
    }

    const exportArgs = [
      'xctrace',
      'export',
      '--input',
      tracePath,
      '--xpath',
      '/trace-toc/run/data/table[@schema="activity-monitor-process-live"]',
      '--output',
      exportPath,
    ];
    const exportResult = await runCmd('xcrun', exportArgs, {
      allowFailure: true,
      timeoutMs: IOS_DEVICE_PERF_EXPORT_TIMEOUT_MS,
    });
    if (exportResult.exitCode !== 0) {
      throw new AppError(
        'COMMAND_FAILED',
        `Failed to export iOS device perf sample for ${appBundleId}`,
        {
          cmd: 'xcrun',
          args: exportArgs,
          exitCode: exportResult.exitCode,
          stdout: exportResult.stdout,
          stderr: exportResult.stderr,
          appBundleId,
          deviceId: device.id,
          hint: resolveIosDevicePerfHint(exportResult.stdout, exportResult.stderr),
        },
      );
    }
    return {
      capturedAtMs,
      xml: await fs.readFile(exportPath, 'utf8'),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function summarizeIosDevicePerfSnapshot(
  samples: IosDevicePerfProcessSample[],
  processes: IosDeviceProcessInfo[],
  appBundleId: string,
  device: DeviceInfo,
): {
  cpuTimeNs: number | null;
  residentMemoryBytes: number | null;
  matchedProcesses: string[];
} {
  const processIds = new Set(processes.map((process) => process.pid));
  const processNames = new Set(
    processes.map((process) => path.basename(fileURLToPath(process.executable))),
  );
  const matchedSamples = samples.filter(
    (sample) => processIds.has(sample.pid) || processNames.has(sample.processName),
  );
  if (matchedSamples.length === 0) {
    throw new AppError('COMMAND_FAILED', `No Activity Monitor sample found for ${appBundleId}`, {
      appBundleId,
      deviceId: device.id,
      hint: 'Keep the app running in the foreground while perf samples the device, then retry.',
    });
  }

  const cpuTimeValues = matchedSamples
    .map((sample) => sample.cpuTimeNs)
    .filter((value): value is number => value !== null);
  const residentMemoryValues = matchedSamples
    .map((sample) => sample.residentMemoryBytes)
    .filter((value): value is number => value !== null);
  return {
    cpuTimeNs:
      cpuTimeValues.length > 0 ? cpuTimeValues.reduce((total, value) => total + value, 0) : null,
    residentMemoryBytes:
      residentMemoryValues.length > 0
        ? residentMemoryValues.reduce((total, value) => total + value, 0)
        : null,
    matchedProcesses: uniqueStrings(matchedSamples.map((sample) => sample.processName)),
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

function buildApplePerfSamples(args: {
  usagePercent: number;
  residentMemoryKb: number;
  measuredAt: string;
  matchedProcesses: string[];
  cpuMethod: AppleCpuPerfSample['method'];
  memoryMethod: AppleMemoryPerfSample['method'];
}): { cpu: AppleCpuPerfSample; memory: AppleMemoryPerfSample } {
  return {
    cpu: {
      usagePercent: roundPercent(args.usagePercent),
      measuredAt: args.measuredAt,
      method: args.cpuMethod,
      matchedProcesses: args.matchedProcesses,
    },
    memory: {
      residentMemoryKb: Math.round(args.residentMemoryKb),
      measuredAt: args.measuredAt,
      method: args.memoryMethod,
      matchedProcesses: args.matchedProcesses,
    },
  };
}

function splitTopLevelXmlElements(xml: string): string[] {
  const children: string[] = [];
  let cursor = 0;
  while (cursor < xml.length) {
    const start = xml.indexOf('<', cursor);
    if (start < 0) break;
    const openEnd = xml.indexOf('>', start);
    if (openEnd < 0) break;
    const openTag = xml.slice(start + 1, openEnd).trim();
    if (!openTag || openTag.startsWith('/') || openTag.startsWith('?') || openTag.startsWith('!')) {
      cursor = openEnd + 1;
      continue;
    }
    const nameMatch = openTag.match(/^([^\s/>]+)/);
    const name = nameMatch?.[1];
    if (!name) {
      cursor = openEnd + 1;
      continue;
    }
    if (openTag.endsWith('/')) {
      children.push(xml.slice(start, openEnd + 1));
      cursor = openEnd + 1;
      continue;
    }

    let depth = 1;
    let position = openEnd + 1;
    while (depth > 0) {
      const nextStart = xml.indexOf('<', position);
      if (nextStart < 0) break;
      const nextEnd = xml.indexOf('>', nextStart);
      if (nextEnd < 0) break;
      const nextTag = xml.slice(nextStart + 1, nextEnd).trim();
      const nextNameMatch = nextTag.match(/^\/?([^\s/>]+)/);
      const nextName = nextNameMatch?.[1];
      if (nextName === name) {
        if (nextTag.startsWith('/')) {
          depth -= 1;
        } else if (!nextTag.endsWith('/')) {
          depth += 1;
        }
      }
      position = nextEnd + 1;
    }
    children.push(xml.slice(start, position));
    cursor = position;
  }
  return children;
}

function parseXmlElement(raw: string): ParsedXmlElement {
  const openEnd = raw.indexOf('>');
  const openTag = openEnd >= 0 ? raw.slice(0, openEnd + 1) : raw;
  const closeStart = raw.lastIndexOf('</');
  const text =
    openEnd >= 0 && closeStart > openEnd
      ? raw
          .slice(openEnd + 1, closeStart)
          .replace(/<[^>]+>/g, '')
          .trim() || null
      : null;
  return {
    raw,
    id: readXmlAttribute(openTag, 'id'),
    ref: readXmlAttribute(openTag, 'ref'),
    fmt: readXmlAttribute(openTag, 'fmt'),
    text,
  };
}

function parseDirectXmlNumber(element: ParsedXmlElement | undefined): number | null {
  if (!element || element.raw.includes('<sentinel')) return null;
  if (!element.text) return null;
  const value = Number(element.text);
  return Number.isFinite(value) ? value : null;
}

function resolveXmlNumber(
  element: ParsedXmlElement | undefined,
  references: Map<string, { numberValue?: number | null }>,
): number | null {
  if (!element) return null;
  if (element.ref) {
    return references.get(element.ref)?.numberValue ?? null;
  }
  return parseDirectXmlNumber(element);
}

function readDirectProcessNameFromXml(element: ParsedXmlElement | undefined): string | null {
  const fmt = element?.fmt?.trim() ?? '';
  if (!fmt) return null;
  return fmt.replace(/\s+\(\d+\)$/, '').trim();
}

function resolveProcessName(
  element: ParsedXmlElement | undefined,
  references: Map<string, { processName?: string | null }>,
): string | null {
  if (!element) return null;
  if (element.ref) {
    return references.get(element.ref)?.processName ?? null;
  }
  return readDirectProcessNameFromXml(element);
}

function readXmlAttribute(openTag: string, attribute: string): string | undefined {
  const match = openTag.match(new RegExp(`\\b${attribute}="([^"]+)"`));
  return match?.[1];
}

function resolveIosDevicePerfHint(stdout: string, stderr: string): string {
  const devicectlHint = resolveIosDevicectlHint(stdout, stderr);
  if (devicectlHint) return devicectlHint;
  const text = `${stdout}\n${stderr}`.toLowerCase();
  if (text.includes('no device matched') || text.includes('failed to find device')) {
    return IOS_DEVICECTL_DEFAULT_HINT;
  }
  if (text.includes('timed out')) {
    return 'Keep the iOS device unlocked and connected by cable, keep the app active, then retry perf.';
  }
  return 'Ensure the iOS device is unlocked, trusted, visible to xctrace, and the target app stays active while perf samples it.';
}

function roundPercent(value: number): number {
  return Math.round(value * 10) / 10;
}
