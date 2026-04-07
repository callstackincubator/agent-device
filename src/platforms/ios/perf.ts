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

type IosDevicePerfCapture = {
  capturedAtMs: number;
  xml: string;
};

type XmlParserInstance = {
  parse(xml: string): unknown;
};

type XmlValue = Record<string, unknown>;

let xmlParserPromise: Promise<XmlParserInstance> | null = null;

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

async function parseIosDevicePerfTable(xml: string): Promise<IosDevicePerfProcessSample[]> {
  const document = await parseXmlDocument(xml);
  const node = asXmlObject(document['trace-query-result'])?.node;
  const schema = asXmlObject(asXmlObject(node)?.schema);
  if (!schema || schema.name !== 'activity-monitor-process-live') {
    throw new AppError(
      'COMMAND_FAILED',
      'Failed to parse xctrace activity-monitor-process-live schema',
    );
  }
  const mnemonics = asXmlArray(schema.col).map(
    (column) => asXmlObject(column)?.mnemonic?.toString().trim() ?? '',
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

  const rows = asXmlArray(asXmlObject(node)?.row);
  const samples: IosDevicePerfProcessSample[] = [];
  const references = new Map<
    string,
    {
      numberValue?: number | null;
      processName?: string | null;
    }
  >();
  for (const row of rows) {
    const elements = readRowElements(row);
    if (elements.length === 0) continue;
    for (const element of elements) {
      const nestedPid = asXmlObject(element.value.pid);
      if (typeof nestedPid?.id === 'string') {
        const pidValue = readXmlNumber(nestedPid);
        references.set(nestedPid.id, {
          numberValue: Number.isFinite(pidValue) ? pidValue : null,
        });
      }
      if (typeof element.value.id !== 'string') continue;
      references.set(element.value.id, {
        numberValue: parseDirectXmlNumber(element.value),
        processName: readDirectProcessNameFromXml(element.value),
      });
    }

    const pid = resolveXmlNumber(elements[pidIndex]?.value, references);
    const processName = resolveProcessName(elements[processIndex]?.value, references);
    if (pid === null || !Number.isFinite(pid) || !processName) continue;
    samples.push({
      pid,
      processName,
      cpuTimeNs: resolveXmlNumber(elements[cpuTimeIndex]?.value, references),
      residentMemoryBytes: resolveXmlNumber(elements[residentMemoryIndex]?.value, references),
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
  const firstCapture = await captureIosDevicePerfTable(device, appBundleId);
  const secondCapture = await captureIosDevicePerfTable(device, appBundleId);
  const firstSnapshot = summarizeIosDevicePerfSnapshot(
    await parseIosDevicePerfTable(firstCapture.xml),
    processes,
    appBundleId,
    device,
  );
  const secondSnapshot = summarizeIosDevicePerfSnapshot(
    await parseIosDevicePerfTable(secondCapture.xml),
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
    measuredAt: new Date(secondCapture.capturedAtMs).toISOString(),
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

  const latestSamplesByPid = new Map<number, IosDevicePerfProcessSample>();
  for (const sample of matchedSamples) {
    const previous = latestSamplesByPid.get(sample.pid);
    if (!previous) {
      latestSamplesByPid.set(sample.pid, sample);
      continue;
    }
    latestSamplesByPid.set(sample.pid, {
      pid: sample.pid,
      processName: sample.processName || previous.processName,
      cpuTimeNs: maxNullableNumber(previous.cpuTimeNs, sample.cpuTimeNs),
      residentMemoryBytes: maxNullableNumber(
        previous.residentMemoryBytes,
        sample.residentMemoryBytes,
      ),
    });
  }

  const latestSamples = [...latestSamplesByPid.values()];
  const cpuTimeValues = latestSamples
    .map((sample) => sample.cpuTimeNs)
    .filter((value): value is number => value !== null);
  const residentMemoryValues = latestSamples
    .map((sample) => sample.residentMemoryBytes)
    .filter((value): value is number => value !== null);
  return {
    cpuTimeNs:
      cpuTimeValues.length > 0 ? cpuTimeValues.reduce((total, value) => total + value, 0) : null,
    residentMemoryBytes:
      residentMemoryValues.length > 0
        ? residentMemoryValues.reduce((total, value) => total + value, 0)
        : null,
    matchedProcesses: uniqueStrings(latestSamples.map((sample) => sample.processName)),
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

async function loadXmlParser(): Promise<XmlParserInstance> {
  xmlParserPromise ??= import('fast-xml-parser').then(
    ({ XMLParser }) =>
      new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: '',
        trimValues: true,
        parseTagValue: false,
        isArray: (name) => name === 'col' || name === 'row',
      }),
  );
  return await xmlParserPromise;
}

async function parseXmlDocument(xml: string): Promise<XmlValue> {
  const parser = await loadXmlParser();
  return asXmlObject(parser.parse(xml)) ?? {};
}

function asXmlObject(value: unknown): XmlValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as XmlValue;
}

function asXmlArray(value: unknown): XmlValue[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => asXmlObject(entry))
    .filter((entry): entry is XmlValue => entry !== null);
}

function readRowElements(row: unknown): Array<{ name: string; value: XmlValue }> {
  const xmlRow = asXmlObject(row);
  if (!xmlRow) return [];
  // fast-xml-parser currently preserves child key insertion order, which keeps row elements aligned
  // with the exported schema column order that we index into below.
  return Object.entries(xmlRow)
    .map(([name, value]) => {
      const element = asXmlObject(value);
      return element ? { name, value: element } : null;
    })
    .filter((entry): entry is { name: string; value: XmlValue } => entry !== null);
}

function readXmlNumber(element: XmlValue | undefined): number | null {
  if (!element) return null;
  const text = typeof element['#text'] === 'string' ? element['#text'].trim() : '';
  if (text.length === 0) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

function parseDirectXmlNumber(element: XmlValue | undefined): number | null {
  if (!element || asXmlObject(element.sentinel)) return null;
  return readXmlNumber(element);
}

function resolveXmlNumber(
  element: XmlValue | undefined,
  references: Map<string, { numberValue?: number | null }>,
): number | null {
  if (!element) return null;
  if (typeof element.ref === 'string') {
    return references.get(element.ref)?.numberValue ?? null;
  }
  return parseDirectXmlNumber(element);
}

function readDirectProcessNameFromXml(element: XmlValue | undefined): string | null {
  const fmt = typeof element?.fmt === 'string' ? element.fmt.trim() : '';
  if (!fmt) return null;
  return fmt.replace(/\s+\(\d+\)$/, '').trim();
}

function resolveProcessName(
  element: XmlValue | undefined,
  references: Map<string, { processName?: string | null }>,
): string | null {
  if (!element) return null;
  if (typeof element.ref === 'string') {
    return references.get(element.ref)?.processName ?? null;
  }
  return readDirectProcessNameFromXml(element);
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

function maxNullableNumber(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
