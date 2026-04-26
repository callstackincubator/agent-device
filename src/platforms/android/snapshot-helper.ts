import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppError } from '../../utils/errors.ts';
import type { RawSnapshotNode, SnapshotOptions } from '../../utils/snapshot.ts';
import { parseUiHierarchy } from './ui-hierarchy.ts';
import type { AndroidSnapshotAnalysis } from './ui-hierarchy.ts';
import {
  ANDROID_SNAPSHOT_MAX_NODES,
  type AndroidSnapshotBackendMetadata,
} from './snapshot-types.ts';

export const ANDROID_SNAPSHOT_HELPER_NAME = 'android-snapshot-helper';
export const ANDROID_SNAPSHOT_HELPER_PACKAGE = 'com.callstack.agentdevice.snapshothelper';
export const ANDROID_SNAPSHOT_HELPER_RUNNER =
  'com.callstack.agentdevice.snapshothelper/.SnapshotInstrumentation';
export const ANDROID_SNAPSHOT_HELPER_PROTOCOL = 'android-snapshot-helper-v1';
export const ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT = 'uiautomator-xml';
export const ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS = 500;

export type AndroidAdbExecutor = (
  args: string[],
  options?: {
    allowFailure?: boolean;
    timeoutMs?: number;
  },
) => Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}>;

export type AndroidSnapshotHelperManifest = {
  name: 'android-snapshot-helper';
  version: string;
  releaseTag?: string;
  assetName?: string;
  apkUrl: string | null;
  sha256: string;
  checksumName?: string;
  packageName: string;
  versionCode: number;
  instrumentationRunner: string;
  minSdk: number;
  targetSdk?: number;
  outputFormat: 'uiautomator-xml';
  statusProtocol: 'android-snapshot-helper-v1';
  installArgs: string[];
};

export type AndroidSnapshotHelperArtifact = {
  apkPath: string;
  manifest: AndroidSnapshotHelperManifest;
};

export type AndroidSnapshotHelperPreparedArtifact = AndroidSnapshotHelperArtifact & {
  cleanup?: () => Promise<void>;
};

export type AndroidSnapshotHelperInstallPolicy = 'missing-or-outdated' | 'always' | 'never';

export type AndroidSnapshotHelperInstallResult = {
  packageName: string;
  versionCode: number;
  installedVersionCode?: number;
  installed: boolean;
  reason: 'missing' | 'outdated' | 'forced' | 'current' | 'skipped';
};

export type AndroidSnapshotHelperCaptureOptions = {
  adb: AndroidAdbExecutor;
  packageName?: string;
  instrumentationRunner?: string;
  waitForIdleTimeoutMs?: number;
  timeoutMs?: number;
  commandTimeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
};

export type AndroidSnapshotHelperMetadata = {
  helperApiVersion?: string;
  outputFormat: 'uiautomator-xml';
  waitForIdleTimeoutMs?: number;
  timeoutMs?: number;
  maxDepth?: number;
  maxNodes?: number;
  rootPresent?: boolean;
  nodeCount?: number;
  truncated?: boolean;
  elapsedMs?: number;
};

export type AndroidSnapshotHelperOutput = {
  xml: string;
  metadata: AndroidSnapshotHelperMetadata;
};

export type AndroidSnapshotHelperParsedSnapshot = {
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
  metadata: AndroidSnapshotHelperMetadata;
};

export type { AndroidSnapshotBackendMetadata };

export async function ensureAndroidSnapshotHelper(options: {
  adb: AndroidAdbExecutor;
  artifact: AndroidSnapshotHelperArtifact;
  installPolicy?: AndroidSnapshotHelperInstallPolicy;
  timeoutMs?: number;
}): Promise<AndroidSnapshotHelperInstallResult> {
  const { adb, artifact } = options;
  const installPolicy = options.installPolicy ?? 'missing-or-outdated';
  const packageName = artifact.manifest.packageName;
  const versionCode = artifact.manifest.versionCode;
  if (installPolicy === 'never') {
    return {
      packageName,
      versionCode,
      installed: false,
      reason: 'skipped',
    };
  }
  const installedVersionCode = await readInstalledVersionCode(adb, packageName, options.timeoutMs);
  const reason = getInstallReason(installPolicy, installedVersionCode, versionCode);

  if (reason === 'current') {
    return {
      packageName,
      versionCode,
      installedVersionCode,
      installed: false,
      reason,
    };
  }

  await verifyAndroidSnapshotHelperArtifact(artifact);
  const installArgs = [...artifact.manifest.installArgs, artifact.apkPath];
  const result = await installAndroidSnapshotHelper(adb, installArgs, {
    packageName,
    timeoutMs: options.timeoutMs,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to install Android snapshot helper', {
      packageName,
      versionCode,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }

  return {
    packageName,
    versionCode,
    installedVersionCode,
    installed: true,
    reason,
  };
}

export async function verifyAndroidSnapshotHelperArtifact(
  artifact: AndroidSnapshotHelperArtifact,
): Promise<void> {
  const actual = await sha256File(artifact.apkPath);
  if (actual !== artifact.manifest.sha256.toLowerCase()) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper APK checksum mismatch', {
      apkPath: artifact.apkPath,
      expectedSha256: artifact.manifest.sha256,
      actualSha256: actual,
    });
  }
}

export async function prepareAndroidSnapshotHelperArtifactFromManifestUrl(options: {
  manifestUrl: string;
  cacheDir?: string;
  fetch?: typeof fetch;
}): Promise<AndroidSnapshotHelperPreparedArtifact> {
  const fetchImpl = options.fetch ?? fetch;
  const manifestResponse = await fetchImpl(options.manifestUrl);
  if (!manifestResponse.ok) {
    throw new AppError('COMMAND_FAILED', 'Failed to download Android snapshot helper manifest', {
      manifestUrl: options.manifestUrl,
      status: manifestResponse.status,
      statusText: manifestResponse.statusText,
    });
  }
  const manifest = parseAndroidSnapshotHelperManifest(await manifestResponse.json());
  if (!manifest.apkUrl) {
    throw new AppError(
      'COMMAND_FAILED',
      'Android snapshot helper manifest does not include apkUrl',
      {
        manifestUrl: options.manifestUrl,
      },
    );
  }

  const cacheDir =
    options.cacheDir ??
    path.join(os.tmpdir(), `agent-device-android-snapshot-helper-${manifest.version}`);
  await fsp.mkdir(cacheDir, { recursive: true });
  const apkName =
    manifest.assetName ?? `agent-device-android-snapshot-helper-${manifest.version}.apk`;
  const apkPath = path.join(cacheDir, apkName);
  const apkResponse = await fetchImpl(manifest.apkUrl);
  if (!apkResponse.ok) {
    throw new AppError('COMMAND_FAILED', 'Failed to download Android snapshot helper APK', {
      apkUrl: manifest.apkUrl,
      status: apkResponse.status,
      statusText: apkResponse.statusText,
    });
  }
  await fsp.writeFile(apkPath, Buffer.from(await apkResponse.arrayBuffer()));
  const artifact = { apkPath, manifest };
  await verifyAndroidSnapshotHelperArtifact(artifact);
  return {
    ...artifact,
    cleanup: async () => {
      await fsp.rm(apkPath, { force: true });
    },
  };
}

export async function captureAndroidSnapshotWithHelper(
  options: AndroidSnapshotHelperCaptureOptions,
): Promise<AndroidSnapshotHelperOutput> {
  const waitForIdleTimeoutMs =
    options.waitForIdleTimeoutMs ?? ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const commandTimeoutMs = options.commandTimeoutMs ?? timeoutMs + 5_000;
  const maxDepth = options.maxDepth ?? 128;
  const maxNodes = options.maxNodes ?? 5_000;
  const packageName = options.packageName ?? ANDROID_SNAPSHOT_HELPER_PACKAGE;
  const runner = options.instrumentationRunner ?? `${packageName}/.SnapshotInstrumentation`;
  const args = [
    'shell',
    'am',
    'instrument',
    '-w',
    '-e',
    'waitForIdleTimeoutMs',
    String(waitForIdleTimeoutMs),
    '-e',
    'timeoutMs',
    String(timeoutMs),
    '-e',
    'maxDepth',
    String(maxDepth),
    '-e',
    'maxNodes',
    String(maxNodes),
    runner,
  ];

  const result = await options.adb(args, {
    allowFailure: true,
    timeoutMs: commandTimeoutMs,
  });
  let output: AndroidSnapshotHelperOutput;
  try {
    output = parseAndroidSnapshotHelperOutput(`${result.stdout}\n${result.stderr}`);
  } catch (error) {
    throw new AppError(
      'COMMAND_FAILED',
      result.exitCode === 0
        ? 'Android snapshot helper output could not be parsed'
        : 'Android snapshot helper failed before returning parseable output',
      {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      },
      error,
    );
  }
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper failed', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      helper: output.metadata,
    });
  }
  return output;
}

export function parseAndroidSnapshotHelperOutput(output: string): AndroidSnapshotHelperOutput {
  const records = parseInstrumentationRecords(output);
  const chunks = records.status
    .filter(
      (record) =>
        record.agentDeviceProtocol === ANDROID_SNAPSHOT_HELPER_PROTOCOL &&
        record.outputFormat === ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT &&
        typeof record.payloadBase64 === 'string',
    )
    .map((record) => ({
      index: readOptionalNumber(record.chunkIndex),
      count: readOptionalNumber(record.chunkCount),
      payloadBase64: record.payloadBase64,
    }));

  const finalResult = records.results.find(
    (record) => record.agentDeviceProtocol === ANDROID_SNAPSHOT_HELPER_PROTOCOL,
  );
  if (!finalResult) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper did not return a final result');
  }
  if (finalResult.ok !== 'true') {
    throw new AppError(
      'COMMAND_FAILED',
      finalResult.message && finalResult.message !== 'null'
        ? finalResult.message
        : finalResult.errorType || 'Android snapshot helper returned an error',
      {
        errorType: finalResult.errorType,
        helper: finalResult,
      },
    );
  }
  if (chunks.length === 0) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper did not return XML chunks', {
      helper: finalResult,
    });
  }

  const chunkCount = chunks[0]?.count ?? chunks.length;
  if (
    chunkCount < 1 ||
    chunks.length !== chunkCount ||
    chunks.some((chunk) => chunk.count !== chunkCount)
  ) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper returned incomplete XML chunks', {
      expectedChunks: chunkCount,
      actualChunks: chunks.length,
    });
  }
  const chunksByIndex = new Map<number, string>();
  for (const chunk of chunks) {
    if (chunk.index === undefined || chunk.index < 0 || chunk.index >= chunkCount) {
      throw new AppError('COMMAND_FAILED', 'Android snapshot helper returned invalid chunk index', {
        chunkIndex: chunk.index,
        expectedChunks: chunkCount,
      });
    }
    if (chunksByIndex.has(chunk.index)) {
      throw new AppError(
        'COMMAND_FAILED',
        'Android snapshot helper returned duplicate XML chunks',
        {
          chunkIndex: chunk.index,
        },
      );
    }
    chunksByIndex.set(chunk.index, chunk.payloadBase64);
  }

  const payloads: Buffer[] = [];
  for (let index = 0; index < chunkCount; index += 1) {
    const payloadBase64 = chunksByIndex.get(index);
    if (!payloadBase64) {
      throw new AppError(
        'COMMAND_FAILED',
        'Android snapshot helper returned incomplete XML chunks',
        {
          missingChunkIndex: index,
          expectedChunks: chunkCount,
        },
      );
    }
    payloads.push(Buffer.from(payloadBase64, 'base64'));
  }
  const xml = Buffer.concat(payloads).toString('utf8');
  if (!xml.includes('<hierarchy') || !xml.includes('</hierarchy>')) {
    throw new AppError('COMMAND_FAILED', 'Android snapshot helper output did not contain XML', {
      xml,
    });
  }

  return {
    xml,
    metadata: {
      helperApiVersion: finalResult.helperApiVersion,
      outputFormat: ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT,
      waitForIdleTimeoutMs: readOptionalNumber(finalResult.waitForIdleTimeoutMs),
      timeoutMs: readOptionalNumber(finalResult.timeoutMs),
      maxDepth: readOptionalNumber(finalResult.maxDepth),
      maxNodes: readOptionalNumber(finalResult.maxNodes),
      rootPresent: readOptionalBoolean(finalResult.rootPresent),
      nodeCount: readOptionalNumber(finalResult.nodeCount),
      truncated: readOptionalBoolean(finalResult.truncated),
      elapsedMs: readOptionalNumber(finalResult.elapsedMs),
    },
  };
}

export function parseAndroidSnapshotHelperSnapshot(
  output: string,
  options: SnapshotOptions = {},
  maxNodes: number = ANDROID_SNAPSHOT_MAX_NODES,
): AndroidSnapshotHelperParsedSnapshot {
  const parsed = parseAndroidSnapshotHelperOutput(output);
  return parseAndroidSnapshotHelperXml(parsed.xml, parsed.metadata, options, maxNodes);
}

export function parseAndroidSnapshotHelperXml(
  xml: string,
  metadata: AndroidSnapshotHelperMetadata = {
    outputFormat: ANDROID_SNAPSHOT_HELPER_OUTPUT_FORMAT,
  },
  options: SnapshotOptions = {},
  maxNodes: number = ANDROID_SNAPSHOT_MAX_NODES,
): AndroidSnapshotHelperParsedSnapshot {
  return {
    ...parseUiHierarchy(xml, maxNodes, options),
    metadata,
  };
}

export function parseAndroidSnapshotHelperManifest(value: unknown): AndroidSnapshotHelperManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AppError('INVALID_ARGS', 'Android snapshot helper manifest must be an object.');
  }
  const record = value as Record<string, unknown>;
  return {
    name: readLiteral(record.name, 'name', 'android-snapshot-helper'),
    version: readString(record.version, 'version'),
    releaseTag: readOptionalString(record.releaseTag),
    assetName: readOptionalString(record.assetName),
    apkUrl: readOptionalNullableString(record.apkUrl, 'apkUrl'),
    sha256: readString(record.sha256, 'sha256').toLowerCase(),
    checksumName: readOptionalString(record.checksumName),
    packageName: readString(record.packageName, 'packageName'),
    versionCode: readNumber(record.versionCode, 'versionCode'),
    instrumentationRunner: readString(record.instrumentationRunner, 'instrumentationRunner'),
    minSdk: readNumber(record.minSdk, 'minSdk'),
    targetSdk:
      record.targetSdk === undefined ? undefined : readNumber(record.targetSdk, 'targetSdk'),
    outputFormat: readLiteral(record.outputFormat, 'outputFormat', 'uiautomator-xml'),
    statusProtocol: readLiteral(
      record.statusProtocol,
      'statusProtocol',
      'android-snapshot-helper-v1',
    ),
    installArgs: readStringArray(record.installArgs, 'installArgs'),
  };
}

async function readInstalledVersionCode(
  adb: AndroidAdbExecutor,
  packageName: string,
  timeoutMs: number | undefined,
): Promise<number | undefined> {
  const result = await adb(
    ['shell', 'cmd', 'package', 'list', 'packages', '--show-versioncode', packageName],
    {
      allowFailure: true,
      timeoutMs,
    },
  );
  if (result.exitCode === 0) {
    return parsePackageListVersionCode(`${result.stdout}\n${result.stderr}`, packageName);
  }
  return undefined;
}

async function installAndroidSnapshotHelper(
  adb: AndroidAdbExecutor,
  installArgs: string[],
  options: { packageName: string; timeoutMs?: number },
): Promise<Awaited<ReturnType<AndroidAdbExecutor>>> {
  const result = await adb(installArgs, { allowFailure: true, timeoutMs: options.timeoutMs });
  if (result.exitCode === 0 || !isInstallUpdateIncompatible(result)) {
    return result;
  }

  const uninstall = await adb(['uninstall', options.packageName], {
    allowFailure: true,
    timeoutMs: options.timeoutMs,
  });
  const retry = await adb(installArgs, { allowFailure: true, timeoutMs: options.timeoutMs });
  if (retry.exitCode === 0) {
    return retry;
  }

  return {
    ...retry,
    stderr: [
      retry.stderr,
      uninstall.stderr
        ? `Previous uninstall stderr after INSTALL_FAILED_UPDATE_INCOMPATIBLE: ${uninstall.stderr}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
  };
}

function parsePackageListVersionCode(output: string, packageName: string): number | undefined {
  const packagePrefix = `package:${packageName}`;
  for (const line of output.split(/\r?\n/)) {
    if (
      !line.startsWith(packagePrefix) ||
      (line.length > packagePrefix.length && !/\s/.test(line[packagePrefix.length] ?? ''))
    ) {
      continue;
    }
    const match = /(?:^|\s)versionCode:(\d+)(?:\s|$)/.exec(line);
    if (match) {
      return Number(match[1]);
    }
  }
  return undefined;
}

function isInstallUpdateIncompatible(result: { stdout: string; stderr: string }): boolean {
  return `${result.stdout}\n${result.stderr}`.includes('INSTALL_FAILED_UPDATE_INCOMPATIBLE');
}

function getInstallReason(
  installPolicy: AndroidSnapshotHelperInstallPolicy,
  installedVersionCode: number | undefined,
  requiredVersionCode: number,
): AndroidSnapshotHelperInstallResult['reason'] {
  if (installPolicy === 'never') {
    return 'skipped';
  }
  if (installPolicy === 'always') {
    return 'forced';
  }
  if (installedVersionCode === undefined) {
    return 'missing';
  }
  return installedVersionCode < requiredVersionCode ? 'outdated' : 'current';
}

function parseInstrumentationRecords(output: string): {
  status: Array<Record<string, string>>;
  results: Array<Record<string, string>>;
} {
  const status: Array<Record<string, string>> = [];
  const results: Array<Record<string, string>> = [];
  let currentStatus: Record<string, string> | null = null;
  let currentResult: Record<string, string> | null = null;

  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('INSTRUMENTATION_STATUS: ')) {
      currentStatus ??= {};
      readKeyValue(line.slice('INSTRUMENTATION_STATUS: '.length), currentStatus);
      continue;
    }
    if (line.startsWith('INSTRUMENTATION_STATUS_CODE: ')) {
      if (currentStatus) {
        status.push(currentStatus);
        currentStatus = null;
      }
      continue;
    }
    if (line.startsWith('INSTRUMENTATION_RESULT: ')) {
      currentResult ??= {};
      readKeyValue(line.slice('INSTRUMENTATION_RESULT: '.length), currentResult);
      continue;
    }
    if (line.startsWith('INSTRUMENTATION_CODE: ')) {
      if (currentResult) {
        results.push(currentResult);
        currentResult = null;
      }
    }
  }

  if (currentStatus) {
    status.push(currentStatus);
  }
  if (currentResult) {
    results.push(currentResult);
  }
  return { status, results };
}

function readKeyValue(line: string, target: Record<string, string>): void {
  const separator = line.indexOf('=');
  if (separator < 0) {
    return;
  }
  target[line.slice(0, separator)] = line.slice(separator + 1);
}

function readOptionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
}

async function sha256File(filePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError('INVALID_ARGS', `Android snapshot helper manifest ${field} is required.`);
  }
  return value;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function readOptionalNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return readString(value, field);
}

function readNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AppError(
      'INVALID_ARGS',
      `Android snapshot helper manifest ${field} must be an integer.`,
    );
  }
  return value;
}

function readLiteral<const Value extends string>(
  value: unknown,
  field: string,
  expected: Value,
): Value {
  if (value !== expected) {
    throw new AppError(
      'INVALID_ARGS',
      `Android snapshot helper manifest ${field} must be "${expected}".`,
    );
  }
  return expected;
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new AppError(
      'INVALID_ARGS',
      `Android snapshot helper manifest ${field} must be a string array.`,
    );
  }
  return value;
}
