import type { CommandFlags } from './core/dispatch.ts';
import type { DaemonRequest, SessionRuntimeHints } from './daemon/types.ts';
import { AppError } from './utils/errors.ts';
import type { DeviceKind, DeviceTarget, Platform } from './utils/device.ts';
import type { SnapshotNode } from './utils/snapshot.ts';
import type {
  AgentDeviceDevice,
  AgentDeviceSession,
  AgentDeviceSessionDevice,
  AppDeployResult,
  AppInstallFromSourceResult,
  InternalRequestOptions,
  MaterializationReleaseResult,
  RuntimeResult,
  StartupPerfSample,
} from './client-types.ts';

export const DEFAULT_SESSION_NAME = 'default';

export function normalizeDeployResult(
  data: Record<string, unknown>,
  session?: string,
): AppDeployResult {
  const bundleId = readOptionalString(data, 'bundleId');
  const pkg = readOptionalString(data, 'package');
  const appId = bundleId ?? pkg;
  return {
    app: readRequiredString(data, 'app'),
    appPath: readRequiredString(data, 'appPath'),
    platform: readRequiredPlatform(data, 'platform'),
    appId,
    bundleId,
    package: pkg,
    identifiers: {
      session,
      appId,
      appBundleId: bundleId,
      package: pkg,
    },
  };
}

export function normalizeRuntimeResult(
  data: Record<string, unknown>,
  session: string,
): RuntimeResult {
  return {
    session,
    configured: data.configured === true,
    cleared: data.cleared === true ? true : undefined,
    runtime: normalizeRuntimeHints(data.runtime),
    identifiers: { session },
  };
}

export function normalizeInstallFromSourceResult(
  data: Record<string, unknown>,
  session?: string,
): AppInstallFromSourceResult {
  const bundleId = readOptionalString(data, 'bundleId');
  const packageName = readOptionalString(data, 'packageName');
  const appId = bundleId ?? packageName;
  return {
    appName: readOptionalString(data, 'appName'),
    appId,
    bundleId,
    packageName,
    launchTarget: readRequiredString(data, 'launchTarget'),
    installablePath: readOptionalString(data, 'installablePath'),
    archivePath: readOptionalString(data, 'archivePath'),
    materializationId: readOptionalString(data, 'materializationId'),
    materializationExpiresAt: readOptionalString(data, 'materializationExpiresAt'),
    identifiers: {
      session,
      appId,
      appBundleId: bundleId,
      package: packageName,
    },
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
  const target = readDeviceTarget(record, 'target');
  return {
    platform,
    target,
    kind: readRequiredDeviceKind(record, 'kind'),
    id,
    name: readRequiredString(record, 'name'),
    booted: typeof record.booted === 'boolean' ? record.booted : undefined,
    identifiers: {
      deviceId: id,
      deviceName: readRequiredString(record, 'name'),
      ...(platform === 'ios' ? { udid: id } : { serial: id }),
    },
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
    deviceId: id,
    deviceName,
    ...(platform === 'ios' ? { udid: id } : { serial: id }),
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
      ios: platform === 'ios'
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

export function normalizeOpenDevice(value: Record<string, unknown>): AgentDeviceSessionDevice | undefined {
  const platform = value.platform;
  const id = readOptionalString(value, 'id');
  const name = readOptionalString(value, 'device');
  if ((platform !== 'ios' && platform !== 'android') || !id || !name) {
    return undefined;
  }
  const target = readDeviceTarget(value, 'target');
  const identifiers = {
    deviceId: id,
    deviceName: name,
    ...(platform === 'ios' ? { udid: id } : { serial: id }),
  };
  return {
    platform,
    target,
    id,
    name,
    identifiers,
    ios: platform === 'ios'
      ? {
        udid: readOptionalString(value, 'device_udid') ?? id,
        simulatorSetPath: readNullableString(value, 'ios_simulator_device_set'),
      }
      : undefined,
    android: platform === 'android'
      ? { serial: readOptionalString(value, 'serial') ?? id }
      : undefined,
  };
}

export function normalizeStartupSample(value: unknown): StartupPerfSample | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.durationMs !== 'number' || typeof value.measuredAt !== 'string' || typeof value.method !== 'string') {
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
  return Array.isArray(value) ? value as SnapshotNode[] : [];
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

export function resolveSessionName(defaultSession: string | undefined, session: string | undefined): string {
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
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('COMMAND_FAILED', `Daemon response is missing "${key}".`, { response: record });
  }
  return value;
}

export function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readNullableString(record: Record<string, unknown>, key: string): string | null | undefined {
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readRequiredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new AppError('COMMAND_FAILED', `Daemon response is missing numeric "${key}".`, { response: record });
  }
  return value;
}

function readRequiredPlatform(record: Record<string, unknown>, key: string): Platform {
  const value = record[key];
  if (value === 'ios' || value === 'android') return value;
  throw new AppError('COMMAND_FAILED', `Daemon response has invalid "${key}".`, { response: record });
}

function readRequiredDeviceKind(record: Record<string, unknown>, key: string): DeviceKind {
  const value = record[key];
  if (value === 'simulator' || value === 'emulator' || value === 'device') return value;
  throw new AppError('COMMAND_FAILED', `Daemon response has invalid "${key}".`, { response: record });
}

function readDeviceTarget(record: Record<string, unknown>, key: string): DeviceTarget {
  return record[key] === 'tv' ? 'tv' : 'mobile';
}
