import fs from 'node:fs/promises';
import path from 'node:path';
import { withRetry } from '../../utils/retry.ts';
import { AppError, normalizeError, toAppErrorCode } from '../../utils/errors.ts';
import { emitDiagnostic, withDiagnosticTimer } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { findProjectRoot, readVersion } from '../../utils/version.ts';
import {
  attachRefs,
  type HiddenContentHint,
  type RawSnapshotNode,
  type SnapshotOptions,
} from '../../utils/snapshot.ts';
import { isScrollableType } from '../../utils/scrollable.ts';
import { deriveMobileSnapshotHiddenContentHints } from '../../utils/mobile-snapshot-semantics.ts';
import {
  buildUiHierarchySnapshot,
  parseUiHierarchy,
  parseUiHierarchyTree,
  type AndroidBuiltSnapshot,
  type AndroidSnapshotAnalysis,
  type AndroidUiHierarchy,
} from './ui-hierarchy.ts';
import { resolveAndroidAdbExecutor, resolveAndroidAdbProvider } from './adb-executor.ts';
import { deriveAndroidScrollableContentHints } from './scroll-hints.ts';
import {
  captureAndroidSnapshotWithHelper,
  ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS,
  ensureAndroidSnapshotHelper,
  forgetAndroidSnapshotHelperInstall,
  parseAndroidSnapshotHelperManifest,
  type AndroidAdbExecutor,
  type AndroidSnapshotHelperArtifact,
  type AndroidSnapshotHelperInstallPolicy,
  type AndroidSnapshotHelperInstallResult,
  type AndroidSnapshotHelperOutput,
} from './snapshot-helper.ts';
import {
  ANDROID_SNAPSHOT_MAX_NODES,
  type AndroidSnapshotBackendMetadata,
} from './snapshot-types.ts';

const UI_HIERARCHY_DUMP_TIMEOUT_MS = 8_000;
const HELPER_INSTALL_TIMEOUT_MS = 30_000;
const HELPER_CAPTURE_TIMEOUT_MS = 5_000;
const HELPER_COMMAND_TIMEOUT_MS = 30_000;
const RETRYABLE_ADB_STDERR_PATTERNS = [
  'device offline',
  'device not found',
  'transport error',
  'connection reset',
  'broken pipe',
  'timed out',
  'no such file or directory',
] as const;

type AndroidSnapshotOptions = SnapshotOptions & {
  helperArtifact?: AndroidSnapshotHelperArtifact;
  helperInstallPolicy?: AndroidSnapshotHelperInstallPolicy;
  helperAdb?: AndroidAdbExecutor;
  helperWaitForIdleTimeoutMs?: number;
  includeHiddenContentHints?: boolean;
};

export async function snapshotAndroid(
  device: DeviceInfo,
  options: AndroidSnapshotOptions = {},
): Promise<{
  nodes: RawSnapshotNode[];
  truncated?: boolean;
  analysis: AndroidSnapshotAnalysis;
  androidSnapshot: AndroidSnapshotBackendMetadata;
}> {
  const adb = resolveAndroidAdbExecutor(device, options.helperAdb);
  const capture = await captureAndroidUiHierarchy(device, options, adb);
  const xml = capture.xml;
  const includeHiddenContentHints = options.includeHiddenContentHints !== false;
  if (!options.interactiveOnly) {
    const parsed = parseUiHierarchy(xml, ANDROID_SNAPSHOT_MAX_NODES, options);
    if (includeHiddenContentHints) {
      const nativeHints = await deriveScrollableContentHintsIfNeeded(device, parsed.nodes, adb);
      applyHiddenContentHintsToNodes(nativeHints, parsed.nodes);
    }
    return { ...parsed, androidSnapshot: capture.metadata };
  }

  const tree = parseUiHierarchyTree(xml);
  const fullSnapshot = buildUiHierarchySnapshot(tree, ANDROID_SNAPSHOT_MAX_NODES, {
    ...options,
    interactiveOnly: false,
  });
  const interactiveSnapshot = buildUiHierarchySnapshot(tree, ANDROID_SNAPSHOT_MAX_NODES, options);
  if (includeHiddenContentHints) {
    const nativeHints = await deriveScrollableContentHintsIfNeeded(device, fullSnapshot.nodes, adb);
    applyHiddenContentHintsToInteractiveNodes(nativeHints, fullSnapshot, interactiveSnapshot);
    if (nativeHints.size === 0) {
      const presentationHints = deriveMobileSnapshotHiddenContentHints(
        attachRefs(fullSnapshot.nodes),
      );
      applyHiddenContentHintsToInteractiveNodes(
        presentationHints,
        fullSnapshot,
        interactiveSnapshot,
      );
    }
  }
  const { sourceNodes: _sourceNodes, ...snapshot } = interactiveSnapshot;
  return { ...snapshot, androidSnapshot: capture.metadata };
}

async function captureAndroidUiHierarchy(
  device: DeviceInfo,
  options: AndroidSnapshotOptions,
  adb: AndroidAdbExecutor,
): Promise<{ xml: string; metadata: AndroidSnapshotBackendMetadata }> {
  const helper = await withDiagnosticTimer(
    'android_snapshot_helper_artifact_resolution',
    async () => await resolveAndroidSnapshotHelperArtifact(options.helperArtifact),
  );
  if (helper.artifact) {
    return await captureAndroidUiHierarchyWithHelper(device, options, adb, helper.artifact);
  }

  emitDiagnostic({
    level: helper.fallbackReason ? 'warn' : 'info',
    phase: 'android_snapshot_helper_unavailable',
    data: { reason: helper.fallbackReason ?? 'artifact_not_found' },
  });
  return await captureStockUiHierarchy(device, helper.fallbackReason, adb);
}

async function captureAndroidUiHierarchyWithHelper(
  device: DeviceInfo,
  options: AndroidSnapshotOptions,
  adb: AndroidAdbExecutor,
  artifact: AndroidSnapshotHelperArtifact,
): Promise<{ xml: string; metadata: AndroidSnapshotBackendMetadata }> {
  const helperDeviceKey = getAndroidSnapshotHelperDeviceKey(device);
  try {
    const install = await installAndroidSnapshotHelper(
      device,
      options,
      adb,
      artifact,
      helperDeviceKey,
    );
    const capture = await captureAndroidUiHierarchyFromHelper(options, adb, artifact);
    return formatAndroidHelperCaptureResult(capture, artifact, install.reason);
  } catch (error) {
    return await recoverAndroidHelperCaptureFailure({
      error,
      helperDeviceKey,
      artifact,
      device,
      adb,
    });
  }
}

async function installAndroidSnapshotHelper(
  device: DeviceInfo,
  options: AndroidSnapshotOptions,
  adb: AndroidAdbExecutor,
  artifact: AndroidSnapshotHelperArtifact,
  deviceKey: string,
): Promise<AndroidSnapshotHelperInstallResult> {
  const install = await withDiagnosticTimer(
    'android_snapshot_helper_install',
    async () =>
      await ensureAndroidSnapshotHelper({
        adb,
        adbProvider: resolveAndroidAdbProvider(device, options.helperAdb),
        artifact,
        deviceKey,
        installPolicy: options.helperInstallPolicy,
        timeoutMs: HELPER_INSTALL_TIMEOUT_MS,
      }),
    {
      packageName: artifact.manifest.packageName,
      versionCode: artifact.manifest.versionCode,
      installPolicy: options.helperInstallPolicy ?? 'missing-or-outdated',
    },
  );
  emitDiagnostic({
    phase: 'android_snapshot_helper_install_decision',
    data: {
      packageName: install.packageName,
      versionCode: install.versionCode,
      installedVersionCode: install.installedVersionCode,
      installed: install.installed,
      reason: install.reason,
    },
  });
  return install;
}

async function captureAndroidUiHierarchyFromHelper(
  options: AndroidSnapshotOptions,
  adb: AndroidAdbExecutor,
  artifact: AndroidSnapshotHelperArtifact,
): Promise<AndroidSnapshotHelperOutput> {
  return await withDiagnosticTimer(
    'android_snapshot_helper_capture',
    async () =>
      await captureAndroidSnapshotWithHelper({
        adb,
        packageName: artifact.manifest.packageName,
        instrumentationRunner: artifact.manifest.instrumentationRunner,
        waitForIdleTimeoutMs:
          options.helperWaitForIdleTimeoutMs ?? ANDROID_SNAPSHOT_HELPER_WAIT_FOR_IDLE_TIMEOUT_MS,
        timeoutMs: HELPER_CAPTURE_TIMEOUT_MS,
        commandTimeoutMs: HELPER_COMMAND_TIMEOUT_MS,
      }),
    {
      packageName: artifact.manifest.packageName,
      version: artifact.manifest.version,
      timeoutMs: HELPER_CAPTURE_TIMEOUT_MS,
      commandTimeoutMs: HELPER_COMMAND_TIMEOUT_MS,
    },
  );
}

function formatAndroidHelperCaptureResult(
  capture: AndroidSnapshotHelperOutput,
  artifact: AndroidSnapshotHelperArtifact,
  installReason: AndroidSnapshotHelperInstallResult['reason'],
): { xml: string; metadata: AndroidSnapshotBackendMetadata } {
  return {
    xml: capture.xml,
    metadata: {
      backend: 'android-helper',
      helperVersion: artifact.manifest.version,
      helperApiVersion: capture.metadata.helperApiVersion,
      installReason,
      waitForIdleTimeoutMs: capture.metadata.waitForIdleTimeoutMs,
      waitForIdleQuietMs: capture.metadata.waitForIdleQuietMs,
      timeoutMs: capture.metadata.timeoutMs,
      maxDepth: capture.metadata.maxDepth,
      maxNodes: capture.metadata.maxNodes,
      rootPresent: capture.metadata.rootPresent,
      captureMode: capture.metadata.captureMode,
      windowCount: capture.metadata.windowCount,
      nodeCount: capture.metadata.nodeCount,
      helperTruncated: capture.metadata.truncated,
      elapsedMs: capture.metadata.elapsedMs,
    },
  };
}

async function recoverAndroidHelperCaptureFailure(params: {
  error: unknown;
  helperDeviceKey: string;
  artifact: AndroidSnapshotHelperArtifact;
  device: DeviceInfo;
  adb: AndroidAdbExecutor;
}): Promise<{ xml: string; metadata: AndroidSnapshotBackendMetadata }> {
  const busyError = formatAndroidSnapshotHelperBusyError(params.error);
  if (busyError) throw busyError;
  const fallbackReason = formatAndroidSnapshotHelperFallbackReason(params.error);
  emitDiagnostic({
    level: 'warn',
    phase: 'android_snapshot_helper_fallback',
    data: { reason: fallbackReason },
  });
  forgetAndroidSnapshotHelperInstall({
    deviceKey: params.helperDeviceKey,
    packageName: params.artifact.manifest.packageName,
    versionCode: params.artifact.manifest.versionCode,
  });
  return await captureStockUiHierarchy(params.device, fallbackReason, params.adb);
}

function formatAndroidSnapshotHelperFallbackReason(error: unknown): string {
  const normalized = normalizeError(error);
  const helperMessage = readHelperMessage(normalized.details?.helper);
  if (helperMessage && helperMessage !== normalized.message) {
    return `${normalized.message}: ${helperMessage}`;
  }
  if (helperMessage) return helperMessage;
  const stderr =
    typeof normalized.details?.stderr === 'string' ? normalized.details.stderr.trim() : '';
  const firstLine = stderr.split(/\r?\n/).find((line) => line.trim());
  return firstLine ? `${normalized.message}: ${firstLine}` : normalized.message;
}

function formatAndroidSnapshotHelperBusyError(error: unknown): AppError | undefined {
  const normalized = normalizeError(error);
  if (
    !isStructuredHelperTimeout(normalized.details?.helper, normalized.message) &&
    !isKilledHelperInstrumentationFailure(normalized) &&
    !isUnsafeStockFallbackHelperReason(normalized.message)
  ) {
    return undefined;
  }
  const reason = formatAndroidSnapshotHelperFallbackReason(error);
  const hint =
    'Android accessibility snapshots can be blocked by busy or continuously changing app UI. Use screenshot as visual truth after this timeout and report the busy UI if it persists.';
  return new AppError(
    toAppErrorCode(normalized.code),
    `${reason}. Stock UIAutomator fallback was skipped because this usually means the Android accessibility tree is busy or stalled.`,
    {
      ...normalized.details,
      hint,
    },
    error,
  );
}

function isKilledHelperInstrumentationFailure(error: {
  message: string;
  details?: Record<string, unknown>;
}): boolean {
  if (error.details?.exitCode !== 137) return false;
  return /Android snapshot helper (failed before returning parseable output|output could not be parsed)/.test(
    error.message,
  );
}

function isUnsafeStockFallbackHelperReason(reason: string): boolean {
  return /Android snapshot helper output could not be parsed/.test(reason);
}

function readHelperMessage(helper: unknown): string | undefined {
  if (!helper || typeof helper !== 'object' || !('message' in helper)) return undefined;
  const message = String(helper.message).trim();
  return message && message !== 'null' ? message : undefined;
}

function isStructuredHelperTimeout(helper: unknown, fallbackMessage: string): boolean {
  if (!helper || typeof helper !== 'object') return false;
  const errorType = 'errorType' in helper ? String(helper.errorType) : '';
  const message = readHelperMessage(helper) ?? fallbackMessage;
  return /TimeoutException/.test(errorType) || /timed out/i.test(message);
}

async function resolveAndroidSnapshotHelperArtifact(
  explicitArtifact?: AndroidSnapshotHelperArtifact,
): Promise<{ artifact?: AndroidSnapshotHelperArtifact; fallbackReason?: string }> {
  if (explicitArtifact) {
    return { artifact: explicitArtifact };
  }

  const version = readVersion();
  const helperDir = path.join(findProjectRoot(), 'android-snapshot-helper', 'dist');
  const manifestPath = path.join(
    helperDir,
    `agent-device-android-snapshot-helper-${version}.manifest.json`,
  );

  try {
    await fs.access(manifestPath);
  } catch {
    return {};
  }

  try {
    const manifest = parseAndroidSnapshotHelperManifest(
      JSON.parse(await fs.readFile(manifestPath, 'utf8')),
    );
    const apkPath = path.join(
      helperDir,
      manifest.assetName ?? `agent-device-android-snapshot-helper-${manifest.version}.apk`,
    );
    await fs.access(apkPath);
    return { artifact: { apkPath, manifest } };
  } catch (error) {
    return { fallbackReason: normalizeError(error).message };
  }
}

async function captureStockUiHierarchy(
  device: DeviceInfo,
  fallbackReason?: string,
  adb?: AndroidAdbExecutor,
): Promise<{ xml: string; metadata: AndroidSnapshotBackendMetadata }> {
  let xml: string;
  try {
    xml = await withDiagnosticTimer(
      'android_snapshot_stock_capture',
      async () => await dumpUiHierarchy(device, adb),
      {
        fallbackReason,
        timeoutMs: UI_HIERARCHY_DUMP_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (fallbackReason) {
      throw enrichStockSnapshotFailureWithHelperReason(error, fallbackReason);
    }
    throw error;
  }
  return {
    xml,
    metadata: {
      backend: 'uiautomator-dump',
      ...(fallbackReason ? { fallbackReason } : {}),
    },
  };
}

function enrichStockSnapshotFailureWithHelperReason(
  error: unknown,
  fallbackReason: string,
): AppError {
  const normalized = normalizeError(error);
  return new AppError(
    toAppErrorCode(normalized.code),
    `${normalized.message} Android snapshot helper failed before stock fallback: ${fallbackReason}`,
    {
      ...normalized.details,
      androidSnapshotHelperFallbackReason: fallbackReason,
      ...(normalized.hint ? { hint: normalized.hint } : {}),
    },
    error,
  );
}

function getAndroidSnapshotHelperDeviceKey(device: DeviceInfo): string {
  return `${device.platform}:${device.id}`;
}

async function deriveScrollableContentHintsIfNeeded(
  device: DeviceInfo,
  nodes: RawSnapshotNode[],
  adb?: AndroidAdbExecutor,
): Promise<Map<number, HiddenContentHint>> {
  if (!nodes.some((node) => isScrollableType(node.type))) {
    return new Map();
  }
  const activityTopDump = await dumpActivityTop(device, adb);
  if (!activityTopDump) {
    return new Map();
  }
  return deriveAndroidScrollableContentHints(nodes, activityTopDump);
}

export async function dumpUiHierarchy(
  device: DeviceInfo,
  adb = resolveAndroidAdbExecutor(device),
): Promise<string> {
  try {
    return await withRetry(() => dumpUiHierarchyOnce(adb), {
      shouldRetry: isRetryableAdbError,
    });
  } catch (error) {
    if (isUiHierarchyDumpTimeout(error)) {
      const hint =
        'Android accessibility snapshots can be blocked by busy or continuously changing app UI. Use screenshot as visual truth after this timeout. Stock Android UIAutomator may still time out on app-owned infinite animations.';
      throw new AppError(
        'COMMAND_FAILED',
        `Android UI hierarchy dump timed out while waiting for the UI to become idle. ${hint}`,
        {
          ...(error.details ?? {}),
          hint,
        },
        error,
      );
    }
    throw error;
  }
}

async function dumpUiHierarchyOnce(adb: AndroidAdbExecutor): Promise<string> {
  // Preferred: stream XML directly to stdout, avoiding file I/O race conditions.
  const streamed = await adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], {
    allowFailure: true,
    timeoutMs: UI_HIERARCHY_DUMP_TIMEOUT_MS,
  });
  const fromStream = extractUiDumpXml(streamed.stdout, streamed.stderr);
  if (fromStream) return fromStream;

  // Fallback: dump to file and read back.
  // If `cat` fails with "no such file", the outer withRetry (via isRetryableAdbError) handles it.
  const dumpPath = '/sdcard/window_dump.xml';
  const dumpResult = await adb(['shell', 'uiautomator', 'dump', dumpPath], {
    allowFailure: true,
    timeoutMs: UI_HIERARCHY_DUMP_TIMEOUT_MS,
  });
  const reportedPath = readDumpPath(dumpResult.stdout, dumpResult.stderr);
  if (dumpResult.exitCode !== 0 && !reportedPath) {
    throw new AppError('COMMAND_FAILED', 'uiautomator dump did not return XML', {
      stdout: dumpResult.stdout,
      stderr: dumpResult.stderr,
      exitCode: dumpResult.exitCode,
      reason: 'missing_fresh_dump',
    });
  }
  const actualPath = reportedPath ?? dumpPath;

  const result = await adb(['shell', 'cat', actualPath]);
  const xml = extractUiDumpXml(result.stdout, result.stderr);
  if (!xml) {
    throw new AppError('COMMAND_FAILED', 'uiautomator dump did not return XML', {
      stdout: result.stdout,
      stderr: result.stderr,
    });
  }
  return xml;
}

function readDumpPath(stdout: string, stderr: string): string | undefined {
  const text = `${stdout}\n${stderr}`;
  const match = /dumped to:\s*(\S+)/i.exec(text);
  return match?.[1];
}

function extractUiDumpXml(stdout: string, stderr: string): string | null {
  const text = `${stdout}\n${stderr}`;
  const start = text.indexOf('<?xml');
  const hierarchyStart = start >= 0 ? start : text.indexOf('<hierarchy');
  if (hierarchyStart < 0) return null;
  const end = text.lastIndexOf('</hierarchy>');
  if (end < 0 || end < hierarchyStart) return null;
  const xml = text.slice(hierarchyStart, end + '</hierarchy>'.length).trim();
  return xml.length > 0 ? xml : null;
}

function isRetryableAdbError(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  if (err.code !== 'COMMAND_FAILED') return false;
  const rawStderr = err.details?.stderr;
  const stderr = (typeof rawStderr === 'string' ? rawStderr : '').toLowerCase();
  return RETRYABLE_ADB_STDERR_PATTERNS.some((pattern) => stderr.includes(pattern));
}

function isUiHierarchyDumpTimeout(err: unknown): err is AppError {
  if (!(err instanceof AppError)) return false;
  if (err.code !== 'COMMAND_FAILED') return false;
  const timeoutMs = err.details?.timeoutMs;
  if (typeof timeoutMs !== 'number') return false;
  return err.details?.cmd === 'adb' && isUiAutomatorDumpArgs(err.details?.args);
}

function isUiAutomatorDumpArgs(rawArgs: unknown): boolean {
  const args = Array.isArray(rawArgs)
    ? rawArgs.map(String)
    : typeof rawArgs === 'string'
      ? rawArgs.split(/\s+/)
      : [];
  return args.includes('uiautomator') && args.includes('dump');
}

async function dumpActivityTop(
  device: DeviceInfo,
  adb = resolveAndroidAdbExecutor(device),
): Promise<string | null> {
  try {
    const result = await adb(['shell', 'dumpsys', 'activity', 'top'], {
      allowFailure: true,
      timeoutMs: 8_000,
    });
    const text = `${result.stdout}\n${result.stderr}`.trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

function applyHiddenContentHintsToInteractiveNodes(
  hintsByFullNodeIndex: ReadonlyMap<number, HiddenContentHint>,
  fullSnapshot: AndroidBuiltSnapshot,
  interactiveSnapshot: AndroidBuiltSnapshot,
): void {
  if (hintsByFullNodeIndex.size === 0) {
    return;
  }

  // Both snapshots come from one parsed hierarchy, so source node identity is the stable bridge
  // between full geometry context and the pruned interactive output.
  const interactiveNodesBySource = new Map<AndroidUiHierarchy, RawSnapshotNode>();
  for (const [index, sourceNode] of interactiveSnapshot.sourceNodes.entries()) {
    const node = interactiveSnapshot.nodes[index];
    if (node) {
      interactiveNodesBySource.set(sourceNode, node);
    }
  }

  for (const [fullIndex, hint] of hintsByFullNodeIndex) {
    const sourceNode = fullSnapshot.sourceNodes[fullIndex];
    if (!sourceNode) {
      continue;
    }
    const interactiveNode = interactiveNodesBySource.get(sourceNode);
    if (!interactiveNode) {
      continue;
    }
    if (hint.hiddenContentAbove) {
      interactiveNode.hiddenContentAbove = true;
    }
    if (hint.hiddenContentBelow) {
      interactiveNode.hiddenContentBelow = true;
    }
  }
}

function applyHiddenContentHintsToNodes(
  hintsByIndex: ReadonlyMap<number, HiddenContentHint>,
  nodes: RawSnapshotNode[],
): void {
  for (const [index, hint] of hintsByIndex) {
    const node = nodes[index];
    if (!node) {
      continue;
    }
    if (hint.hiddenContentAbove) {
      node.hiddenContentAbove = true;
    }
    if (hint.hiddenContentBelow) {
      node.hiddenContentBelow = true;
    }
  }
}
