import type { CommandFlags } from './core/dispatch.ts';
import type { DaemonRequest, SessionRuntimeHints } from './daemon/types.ts';
import { AppError } from './utils/errors.ts';
import type { DeviceKind, DeviceTarget, Platform } from './utils/device.ts';
import type { Point, ScreenshotOverlayRef, SnapshotNode } from './utils/snapshot.ts';
import { buildAppIdentifiers, buildDeviceIdentifiers } from './client-shared.ts';
import type {
  AgentDeviceDevice,
  AgentDeviceSession,
  AgentDeviceSessionDevice,
  AppDeployResult,
  AppInstallFromSourceResult,
  InternalRequestOptions,
  MaterializationReleaseResult,
  StartupPerfSample,
} from './client-types.ts';

export const DEFAULT_SESSION_NAME = 'default';

export function normalizeDeployResult(
  data: Record<string, unknown>,
  session?: string,
): AppDeployResult {
  const bundleId = readOptionalString(data, 'bundleId');
  const pkg = readOptionalString(data, 'package');
  return {
    app: readRequiredString(data, 'app'),
    appPath: readRequiredString(data, 'appPath'),
    platform: readRequiredPlatform(data, 'platform'),
    appId: bundleId ?? pkg,
    bundleId,
    package: pkg,
    identifiers: buildAppIdentifiers({ session, bundleId, packageName: pkg }),
  };
}

export function normalizeInstallFromSourceResult(
  data: Record<string, unknown>,
  session?: string,
): AppInstallFromSourceResult {
  const bundleId = readOptionalString(data, 'bundleId');
  const packageName = readOptionalString(data, 'packageName');
  const appId = bundleId ?? packageName ?? readOptionalString(data, 'appId');
  const launchTarget = readOptionalString(data, 'launchTarget') ?? packageName ?? bundleId ?? appId;
  if (!launchTarget) {
    throw new AppError('COMMAND_FAILED', 'Daemon response is missing "launchTarget".', {
      response: data,
    });
  }
  return {
    appName: readOptionalString(data, 'appName'),
    appId,
    bundleId,
    packageName,
    launchTarget,
    installablePath: readOptionalString(data, 'installablePath'),
    archivePath: readOptionalString(data, 'archivePath'),
    materializationId: readOptionalString(data, 'materializationId'),
    materializationExpiresAt: readOptionalString(data, 'materializationExpiresAt'),
    identifiers: buildAppIdentifiers({ session, bundleId, packageName, appId }),
  };
}

export function normalizeMaterializationReleaseResult(
  data: Record<string, unknown>,
): MaterializationReleaseResult {
  return {
    released: data.released === true,
    materializationId: readRequiredString(data, 'materializationId'),
    identifiers: {},
  };
}

export function normalizeDevice(value: unknown): AgentDeviceDevice {
  const record = asRecord(value);
  const platform = readRequiredPlatform(record, 'platform');
  const id = readRequiredString(record, 'id');
  const name = readRequiredString(record, 'name');
  const target = readDeviceTarget(record, 'target');
  return {
    platform,
    target,
    kind: readRequiredDeviceKind(record, 'kind'),
    id,
    name,
    booted: typeof record.booted === 'boolean' ? record.booted : undefined,
    identifiers: buildDeviceIdentifiers(platform, id, name),
    ios: platform === 'ios' ? { udid: id } : undefined,
    android: platform === 'android' ? { serial: id } : undefined,
  };
}

export function normalizeSession(value: unknown): AgentDeviceSession {
  const record = asRecord(value);
  const platform = readRequiredPlatform(record, 'platform');
  const id = readRequiredString(record, 'id');
  const name = readRequiredString(record, 'name');
  const target = readDeviceTarget(record, 'target');
  const deviceName = readRequiredString(record, 'device');
  const identifiers = {
    session: name,
    ...buildDeviceIdentifiers(platform, id, deviceName),
  };
  return {
    name,
    createdAt: readRequiredNumber(record, 'createdAt'),
    device: {
      platform,
      target,
      id,
      name: deviceName,
      identifiers,
      ios:
        platform === 'ios'
          ? {
              udid: id,
              simulatorSetPath: readNullableString(record, 'ios_simulator_device_set'),
            }
          : undefined,
      android: platform === 'android' ? { serial: id } : undefined,
    },
    identifiers,
  };
}

export function normalizeRuntimeHints(value: unknown): SessionRuntimeHints | undefined {
  if (!isRecord(value)) return undefined;
  const platform = value.platform;
  const metroHost = readOptionalString(value, 'metroHost');
  const metroPort = typeof value.metroPort === 'number' ? value.metroPort : undefined;
  const bundleUrl = readOptionalString(value, 'bundleUrl');
  const launchUrl = readOptionalString(value, 'launchUrl');
  return {
    platform: platform === 'ios' || platform === 'android' ? platform : undefined,
    metroHost,
    metroPort,
    bundleUrl,
    launchUrl,
  };
}

export function normalizeOpenDevice(
  value: Record<string, unknown>,
): AgentDeviceSessionDevice | undefined {
  const platform = value.platform;
  const id = readOptionalString(value, 'id');
  const name = readOptionalString(value, 'device');
  if ((platform !== 'ios' && platform !== 'macos' && platform !== 'android') || !id || !name) {
    return undefined;
  }
  const target = readDeviceTarget(value, 'target');
  const identifiers = buildDeviceIdentifiers(platform, id, name);
  return {
    platform,
    target,
    id,
    name,
    identifiers,
    ios:
      platform === 'ios'
        ? {
            udid: readOptionalString(value, 'device_udid') ?? id,
            simulatorSetPath: readNullableString(value, 'ios_simulator_device_set'),
          }
        : undefined,
    android:
      platform === 'android' ? { serial: readOptionalString(value, 'serial') ?? id } : undefined,
  };
}

export function normalizeStartupSample(value: unknown): StartupPerfSample | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.durationMs !== 'number' ||
    typeof value.measuredAt !== 'string' ||
    typeof value.method !== 'string'
  ) {
    return undefined;
  }
  return {
    durationMs: value.durationMs,
    measuredAt: value.measuredAt,
    method: value.method,
    appTarget: readOptionalString(value, 'appTarget'),
    appBundleId: readOptionalString(value, 'appBundleId'),
  };
}

export function readSnapshotNodes(value: unknown): SnapshotNode[] {
  // Snapshot nodes are produced by the daemon snapshot pipeline and treated as trusted here.
  return Array.isArray(value) ? (value as SnapshotNode[]) : [];
}

export function readScreenshotOverlayRefs(
  record: Record<string, unknown>,
): ScreenshotOverlayRef[] | undefined {
  const value = record.overlayRefs;
  if (!Array.isArray(value)) return undefined;
  const refs: ScreenshotOverlayRef[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const ref = readOptionalString(entry, 'ref');
    const rect = readRect(entry, 'rect');
    const overlayRect = readRect(entry, 'overlayRect');
    const center = readPoint(entry, 'center');
    if (!ref || !rect || !overlayRect || !center) continue;
    refs.push({
      ref,
      label: readOptionalString(entry, 'label'),
      rect,
      overlayRect,
      center,
    });
  }
  return refs;
}

export function buildFlags(options: InternalRequestOptions): CommandFlags {
  return stripUndefined({
    stateDir: options.stateDir,
    daemonBaseUrl: options.daemonBaseUrl,
    daemonAuthToken: options.daemonAuthToken,
    daemonTransport: options.daemonTransport,
    daemonServerMode: options.daemonServerMode,
    tenant: options.tenant,
    sessionIsolation: options.sessionIsolation,
    runId: options.runId,
    leaseId: options.leaseId,
    platform: options.platform,
    target: options.target,
    device: options.device,
    udid: options.udid,
    serial: options.serial,
    iosSimulatorDeviceSet: options.iosSimulatorDeviceSet,
    androidDeviceAllowlist: options.androidDeviceAllowlist,
    runtime: options.simulatorRuntimeId,
    boot: options.boot,
    reuseExisting: options.reuseExisting,
    surface: options.surface,
    activity: options.activity,
    relaunch: options.relaunch,
    shutdown: options.shutdown,
    saveScript: options.saveScript,
    noRecord: options.noRecord,
    metroHost: options.metroHost,
    metroPort: options.metroPort,
    bundleUrl: options.bundleUrl,
    launchUrl: options.launchUrl,
    snapshotInteractiveOnly: options.interactiveOnly,
    snapshotCompact: options.compact,
    snapshotDepth: options.depth,
    snapshotScope: options.scope,
    snapshotRaw: options.raw,
    overlayRefs: options.overlayRefs,
    verbose: options.debug,
  }) as CommandFlags;
}

export function buildMeta(options: InternalRequestOptions): DaemonRequest['meta'] {
  return stripUndefined({
    requestId: options.requestId,
    cwd: options.cwd,
    debug: options.debug,
    lockPolicy: options.lockPolicy,
    lockPlatform: options.lockPlatform,
    tenantId: options.tenant,
    runId: options.runId,
    leaseId: options.leaseId,
    sessionIsolation: options.sessionIsolation,
    installSource: options.installSource,
    retainMaterializedPaths: options.retainMaterializedPaths,
    materializedPathRetentionMs: options.materializedPathRetentionMs,
    materializationId: options.materializationId,
  });
}

export function resolveSessionName(
  defaultSession: string | undefined,
  session: string | undefined,
): string {
  return session ?? defaultSession ?? DEFAULT_SESSION_NAME;
}

function stripUndefined<T extends Record<string, unknown>>(value: T): T {
  const output = {} as T;
  for (const [key, current] of Object.entries(value)) {
    if (current !== undefined) {
      (output as Record<string, unknown>)[key] = current;
    }
  }
  return output;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new AppError('COMMAND_FAILED', 'Daemon returned an unexpected response shape.', {
      value,
    });
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function readRequiredString(record: Record<string, unknown>, key: string): string {
  return readRequired(record, key, parseNonEmptyString, `Daemon response is missing "${key}".`);
}

export function readOptionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  return readOptional(record, key, parseNonEmptyString);
}

export function readNullableString(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  return readNullable(record, key, parseNonEmptyString);
}

function readRequiredNumber(record: Record<string, unknown>, key: string): number {
  return readRequired(
    record,
    key,
    parseFiniteNumber,
    `Daemon response is missing numeric "${key}".`,
  );
}

function readRequiredPlatform(record: Record<string, unknown>, key: string): Platform {
  return readRequired(record, key, parsePlatform, `Daemon response has invalid "${key}".`);
}

function readRequiredDeviceKind(record: Record<string, unknown>, key: string): DeviceKind {
  return readRequired(record, key, parseDeviceKind, `Daemon response has invalid "${key}".`);
}

function readDeviceTarget(record: Record<string, unknown>, key: string): DeviceTarget {
  return readOptional(record, key, parseDeviceTarget) ?? 'mobile';
}

function readRequired<T>(
  record: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T | undefined,
  message: string,
): T {
  const value = parse(record[key]);
  if (value === undefined) {
    throw new AppError('COMMAND_FAILED', message, { response: record });
  }
  return value;
}

function readRect(
  record: Record<string, unknown>,
  key: string,
): { x: number; y: number; width: number; height: number } | undefined {
  const value = record[key];
  if (!isRecord(value)) return undefined;
  const x = typeof value.x === 'number' ? value.x : undefined;
  const y = typeof value.y === 'number' ? value.y : undefined;
  const width = typeof value.width === 'number' ? value.width : undefined;
  const height = typeof value.height === 'number' ? value.height : undefined;
  if (x === undefined || y === undefined || width === undefined || height === undefined) {
    return undefined;
  }
  return { x, y, width, height };
}

function readPoint(record: Record<string, unknown>, key: string): Point | undefined {
  const value = record[key];
  if (!isRecord(value)) return undefined;
  const x = typeof value.x === 'number' ? value.x : undefined;
  const y = typeof value.y === 'number' ? value.y : undefined;
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return { x, y };
}

function readOptional<T>(
  record: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T | undefined,
): T | undefined {
  return parse(record[key]);
}

function readNullable<T>(
  record: Record<string, unknown>,
  key: string,
  parse: (value: unknown) => T | undefined,
): T | null | undefined {
  const value = record[key];
  return value === null ? null : parse(value);
}

function parseNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parsePlatform(value: unknown): Platform | undefined {
  return value === 'ios' || value === 'macos' || value === 'android' ? value : undefined;
}

function parseDeviceKind(value: unknown): DeviceKind | undefined {
  return value === 'simulator' || value === 'emulator' || value === 'device' ? value : undefined;
}

function parseDeviceTarget(value: unknown): DeviceTarget | undefined {
  return value === 'tv' || value === 'mobile' || value === 'desktop' ? value : undefined;
}
