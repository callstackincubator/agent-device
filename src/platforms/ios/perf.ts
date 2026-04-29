import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runCmd } from '../../utils/exec.ts';
import { roundPercent } from '../perf-utils.ts';
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
import { parseXmlDocumentSync, type XmlNode } from './xml.ts';
import {
  APPLE_FRAME_SAMPLE_DESCRIPTION,
  APPLE_FRAME_SAMPLE_METHOD,
  parseAppleFramePerfSample,
  type AppleFramePerfSample,
} from './perf-frame.ts';

const APPLE_CPU_SAMPLE_METHOD = 'ps-process-snapshot';
const APPLE_MEMORY_SAMPLE_METHOD = 'ps-process-snapshot';
const IOS_DEVICE_CPU_SAMPLE_METHOD = 'xctrace-activity-monitor';
const IOS_DEVICE_MEMORY_SAMPLE_METHOD = 'xctrace-activity-monitor';

const APPLE_PERF_TIMEOUT_MS = 15_000;
// Physical device tracing can take materially longer to initialize than the 1s sample window.
const IOS_DEVICE_PERF_RECORD_TIMEOUT_MS = 60_000;
const IOS_DEVICE_PERF_EXPORT_TIMEOUT_MS = 15_000;
const IOS_DEVICE_PERF_TRACE_DURATION = '1s';
const IOS_DEVICE_FRAME_TRACE_DURATION = '2s';

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

type IosDeviceFramePerfCapture = {
  windowStartedAt: string;
  windowEndedAt: string;
  hitchesXml: string;
  frameLifetimesXml: string;
  displayInfoXml: string;
};

type IosDeviceTraceRecord = {
  startedAt: string;
  endedAt: string;
  capturedAtMs: number;
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
  const matchedProcesses = uniqueStrings(processes.map(() => executable.executableName));
  return buildApplePerfSamples({
    usagePercent: processes.reduce((total, process) => total + process.cpuPercent, 0),
    residentMemoryKb: processes.reduce((total, process) => total + process.rssKb, 0),
    measuredAt,
    matchedProcesses,
    cpuMethod: APPLE_CPU_SAMPLE_METHOD,
    memoryMethod: APPLE_MEMORY_SAMPLE_METHOD,
  });
}

export async function sampleAppleFramePerf(
  device: DeviceInfo,
  appBundleId: string,
): Promise<AppleFramePerfSample> {
  if (device.platform !== 'ios' || device.kind !== 'device') {
    throw new AppError(
      'COMMAND_FAILED',
      'Apple frame-health sampling is currently available only on connected iOS devices.',
      {
        metric: 'fps',
        platform: device.platform,
        deviceKind: device.kind,
      },
    );
  }

  const processes = await resolveIosDevicePerfTarget(device, appBundleId);
  const capture = await captureIosDeviceFramePerf(device, appBundleId, processes);
  return parseAppleFramePerfSample({
    hitchesXml: capture.hitchesXml,
    frameLifetimesXml: capture.frameLifetimesXml,
    displayInfoXml: capture.displayInfoXml,
    processIds: processes.map((process) => process.pid),
    processNames: uniqueStrings(
      processes.map((process) => path.basename(fileURLToPath(process.executable))),
    ),
    windowStartedAt: capture.windowStartedAt,
    windowEndedAt: capture.windowEndedAt,
    measuredAt: capture.windowEndedAt,
  });
}

export function buildAppleSamplingMetadata(device: DeviceInfo): Record<string, unknown> {
  const fps =
    device.platform === 'ios' && device.kind === 'device'
      ? {
          method: APPLE_FRAME_SAMPLE_METHOD,
          description: APPLE_FRAME_SAMPLE_DESCRIPTION,
          unit: 'percent',
          primaryField: 'droppedFramePercent',
          window: `short ${IOS_DEVICE_FRAME_TRACE_DURATION} xctrace Animation Hitches record of the active app process`,
          resetsAfterRead: false,
        }
      : {
          method: APPLE_FRAME_SAMPLE_METHOD,
          description:
            'Unavailable on iOS simulators and macOS because local Apple tooling does not expose reliable app frame hitches for these targets.',
          unit: 'percent',
          primaryField: 'droppedFramePercent',
        };
  if (device.platform === 'ios' && device.kind === 'device') {
    return {
      fps,
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
    fps,
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

async function captureIosDeviceFramePerf(
  device: DeviceInfo,
  appBundleId: string,
  processes: IosDeviceProcessInfo[],
): Promise<IosDeviceFramePerfCapture> {
  const targetProcess = requireIosDeviceTargetProcess(device, appBundleId, processes);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-ios-frame-perf-'));
  const tracePath = path.join(tempDir, 'animation-hitches.trace');
  const hitchesPath = path.join(tempDir, 'hitches.xml');
  const frameLifetimesPath = path.join(tempDir, 'frame-lifetimes.xml');
  const displayInfoPath = path.join(tempDir, 'display-info.xml');
  try {
    const record = await recordIosDeviceTrace({
      device,
      appBundleId,
      tracePath,
      template: 'Animation Hitches',
      duration: IOS_DEVICE_FRAME_TRACE_DURATION,
      targetPid: targetProcess.pid,
      failureMessage: `Failed to record iOS frame-health sample for ${appBundleId}`,
    });
    await exportIosDevicePerfTable(device, appBundleId, tracePath, 'hitches', hitchesPath);
    await exportIosDevicePerfTable(
      device,
      appBundleId,
      tracePath,
      'hitches-frame-lifetimes',
      frameLifetimesPath,
    );
    await exportIosDevicePerfTable(
      device,
      appBundleId,
      tracePath,
      'device-display-info',
      displayInfoPath,
    );
    return {
      windowStartedAt: record.startedAt,
      windowEndedAt: record.endedAt,
      hitchesXml: await fs.readFile(hitchesPath, 'utf8'),
      frameLifetimesXml: await fs.readFile(frameLifetimesPath, 'utf8'),
      displayInfoXml: await fs.readFile(displayInfoPath, 'utf8'),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function requireIosDeviceTargetProcess(
  device: DeviceInfo,
  appBundleId: string,
  processes: IosDeviceProcessInfo[],
): IosDeviceProcessInfo {
  const targetProcess = processes[0];
  if (targetProcess) return targetProcess;
  throw new AppError('COMMAND_FAILED', `No running process found for ${appBundleId}`, {
    appBundleId,
    deviceId: device.id,
    hint: 'Run open <app> for this session again to ensure the iOS app is active, then retry perf.',
  });
}

async function recordIosDeviceTrace(params: {
  device: DeviceInfo;
  appBundleId: string;
  tracePath: string;
  template: 'Activity Monitor' | 'Animation Hitches';
  duration: string;
  targetPid?: number;
  allProcesses?: boolean;
  failureMessage: string;
}): Promise<IosDeviceTraceRecord> {
  const { device, appBundleId, tracePath, template, duration } = params;
  const targetArgs = params.allProcesses
    ? ['--all-processes']
    : ['--attach', String(params.targetPid)];
  const recordArgs = [
    'xctrace',
    'record',
    '--template',
    template,
    '--device',
    device.id,
    ...targetArgs,
    '--time-limit',
    duration,
    '--output',
    tracePath,
    '--quiet',
    '--no-prompt',
  ];
  const startedAt = new Date().toISOString();
  const result = await runCmd('xcrun', recordArgs, {
    allowFailure: true,
    timeoutMs: IOS_DEVICE_PERF_RECORD_TIMEOUT_MS,
  });
  const endedAt = new Date().toISOString();
  if (result.exitCode === 0) return { startedAt, endedAt, capturedAtMs: Date.now() };
  throw new AppError('COMMAND_FAILED', params.failureMessage, {
    cmd: 'xcrun',
    args: recordArgs,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    appBundleId,
    deviceId: device.id,
    hint: resolveIosDevicePerfHint(result.stdout, result.stderr),
  });
}

async function exportIosDevicePerfTable(
  device: DeviceInfo,
  appBundleId: string,
  tracePath: string,
  schema: string,
  outputPath: string,
): Promise<void> {
  const exportArgs = [
    'xctrace',
    'export',
    '--input',
    tracePath,
    '--xpath',
    `/trace-toc/run/data/table[@schema="${schema}"]`,
    '--output',
    outputPath,
  ];
  const exportResult = await runCmd('xcrun', exportArgs, {
    allowFailure: true,
    timeoutMs: IOS_DEVICE_PERF_EXPORT_TIMEOUT_MS,
  });
  if (exportResult.exitCode === 0) return;
  throw new AppError('COMMAND_FAILED', `Failed to export iOS device ${schema} data`, {
    cmd: 'xcrun',
    args: exportArgs,
    exitCode: exportResult.exitCode,
    stdout: exportResult.stdout,
    stderr: exportResult.stderr,
    appBundleId,
    deviceId: device.id,
    hint: resolveIosDevicePerfHint(exportResult.stdout, exportResult.stderr),
  });
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
  const document = parseXmlDocumentSync(xml);
  const schema = findFirstXmlNode(
    document,
    (node) => node.name === 'schema' && node.attributes.name === 'activity-monitor-process-live',
  );
  if (!schema) {
    throw new AppError(
      'COMMAND_FAILED',
      'Failed to parse xctrace activity-monitor-process-live schema',
    );
  }
  const mnemonics = schema.children
    .filter((child) => child.name === 'col')
    .map((column) => readFirstChildText(column, 'mnemonic') ?? '');
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

  const rows = findAllXmlNodes(document, (node) => node.name === 'row');
  const samples: IosDevicePerfProcessSample[] = [];
  const references = new Map<
    string,
    {
      numberValue?: number | null;
      processName?: string | null;
    }
  >();
  for (const row of rows) {
    const elements = row.children;
    if (elements.length === 0) continue;
    for (const element of elements) {
      const nestedPid = findFirstXmlNode(
        element.children,
        (child) => child.name === 'pid' && typeof child.attributes.id === 'string',
      );
      if (nestedPid?.attributes.id) {
        const pidValue = Number(nestedPid.text);
        references.set(nestedPid.attributes.id, {
          numberValue: Number.isFinite(pidValue) ? pidValue : null,
        });
      }
      if (!element.attributes.id) continue;
      references.set(element.attributes.id, {
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
    executablePath: path.join(
      appPath,
      device.platform === 'macos' ? 'Contents' : '',
      device.platform === 'macos' ? 'MacOS' : '',
      executableName,
    ),
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
    const record = await recordIosDeviceTrace({
      device,
      appBundleId,
      tracePath,
      template: 'Activity Monitor',
      duration: IOS_DEVICE_PERF_TRACE_DURATION,
      allProcesses: true,
      failureMessage: `Failed to record iOS device Activity Monitor sample for ${appBundleId}`,
    });
    await exportIosDevicePerfTable(
      device,
      appBundleId,
      tracePath,
      'activity-monitor-process-live',
      exportPath,
    );
    return {
      capturedAtMs: record.capturedAtMs,
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
    (command === executable.executablePath ||
      token === executable.executablePath ||
      command.startsWith(`${executable.executablePath} `))
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

function findFirstXmlNode(
  nodes: XmlNode[],
  predicate: (node: XmlNode) => boolean,
): XmlNode | undefined {
  for (const node of nodes) {
    if (predicate(node)) {
      return node;
    }
    const descendant = findFirstXmlNode(node.children, predicate);
    if (descendant) {
      return descendant;
    }
  }
  return undefined;
}

function findAllXmlNodes(nodes: XmlNode[], predicate: (node: XmlNode) => boolean): XmlNode[] {
  const matches: XmlNode[] = [];
  for (const node of nodes) {
    if (predicate(node)) {
      matches.push(node);
    }
    matches.push(...findAllXmlNodes(node.children, predicate));
  }
  return matches;
}

function readFirstChildText(node: XmlNode, childName: string): string | null {
  const child = node.children.find((candidate) => candidate.name === childName);
  return child?.text ?? null;
}

function parseDirectXmlNumber(element: XmlNode | undefined): number | null {
  if (!element || element.children.some((child) => child.name === 'sentinel')) return null;
  if (!element.text) return null;
  const value = Number(element.text);
  return Number.isFinite(value) ? value : null;
}

function resolveXmlNumber(
  element: XmlNode | undefined,
  references: Map<string, { numberValue?: number | null }>,
): number | null {
  if (!element) return null;
  if (element.attributes.ref) {
    return references.get(element.attributes.ref)?.numberValue ?? null;
  }
  return parseDirectXmlNumber(element);
}

function readDirectProcessNameFromXml(element: XmlNode | undefined): string | null {
  const fmt = element?.attributes.fmt?.trim() ?? '';
  if (!fmt) return null;
  return fmt.replace(/\s+\(\d+\)$/, '').trim();
}

function resolveProcessName(
  element: XmlNode | undefined,
  references: Map<string, { processName?: string | null }>,
): string | null {
  if (!element) return null;
  if (element.attributes.ref) {
    return references.get(element.attributes.ref)?.processName ?? null;
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

function maxNullableNumber(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}
