import type { CommandFlags } from './core/dispatch.ts';
import type { DaemonRequest, DaemonResponse, SessionRuntimeHints } from './daemon/types.ts';
import { sendToDaemon } from './daemon-client.ts';
import { AppError } from './utils/errors.ts';
import type { DeviceKind, DeviceTarget, Platform, PlatformSelector } from './utils/device.ts';
import type { SnapshotNode } from './utils/snapshot.ts';

type DaemonTransport = (req: Omit<DaemonRequest, 'token'>) => Promise<DaemonResponse>;

type DaemonTransportMode = 'auto' | 'socket' | 'http';
type DaemonServerMode = 'socket' | 'http' | 'dual';
type SessionIsolationMode = 'none' | 'tenant';
const DEFAULT_SESSION_NAME = 'default';

export type AgentDeviceClientConfig = {
  session?: string;
  requestId?: string;
  stateDir?: string;
  daemonBaseUrl?: string;
  daemonAuthToken?: string;
  daemonTransport?: DaemonTransportMode;
  daemonServerMode?: DaemonServerMode;
  tenant?: string;
  sessionIsolation?: SessionIsolationMode;
  runId?: string;
  leaseId?: string;
  cwd?: string;
  debug?: boolean;
};

export type AgentDeviceIdentifiers = {
  session?: string;
  deviceId?: string;
  deviceName?: string;
  udid?: string;
  serial?: string;
  appId?: string;
  appBundleId?: string;
  package?: string;
};

export type AgentDeviceSelectionOptions = {
  platform?: PlatformSelector;
  target?: DeviceTarget;
  device?: string;
  udid?: string;
  serial?: string;
  iosSimulatorDeviceSet?: string;
  androidDeviceAllowlist?: string;
};

export type AgentDeviceDevice = {
  platform: Platform;
  target: DeviceTarget;
  kind: DeviceKind;
  id: string;
  name: string;
  booted?: boolean;
  identifiers: AgentDeviceIdentifiers;
  ios?: {
    udid: string;
  };
  android?: {
    serial: string;
  };
};

export type AgentDeviceSessionDevice = {
  platform: Platform;
  target: DeviceTarget;
  id: string;
  name: string;
  identifiers: AgentDeviceIdentifiers;
  ios?: {
    udid: string;
    simulatorSetPath?: string | null;
  };
  android?: {
    serial: string;
  };
};

export type AgentDeviceSession = {
  name: string;
  createdAt: number;
  device: AgentDeviceSessionDevice;
  identifiers: AgentDeviceIdentifiers;
};

export type StartupPerfSample = {
  durationMs: number;
  measuredAt: string;
  method: string;
  appTarget?: string;
  appBundleId?: string;
};

export type SessionCloseResult = {
  session: string;
  shutdown?: Record<string, unknown>;
  identifiers: AgentDeviceIdentifiers;
};

export type EnsureSimulatorOptions = AgentDeviceClientConfig & {
  device: string;
  runtime?: string;
  boot?: boolean;
  reuseExisting?: boolean;
  iosSimulatorDeviceSet?: string;
};

export type EnsureSimulatorResult = {
  udid: string;
  device: string;
  runtime: string;
  created: boolean;
  booted: boolean;
  iosSimulatorDeviceSet?: string | null;
  identifiers: AgentDeviceIdentifiers;
};

export type AppDeployOptions = AgentDeviceClientConfig & AgentDeviceSelectionOptions & {
  app: string;
  appPath: string;
};

export type AppDeployResult = {
  app: string;
  appPath: string;
  platform: Platform;
  appId?: string;
  bundleId?: string;
  package?: string;
  identifiers: AgentDeviceIdentifiers;
};

export type AppOpenOptions = AgentDeviceClientConfig & AgentDeviceSelectionOptions & {
  app: string;
  url?: string;
  activity?: string;
  relaunch?: boolean;
  saveScript?: boolean | string;
  noRecord?: boolean;
};

export type AppOpenResult = {
  session: string;
  appName?: string;
  appBundleId?: string;
  appId?: string;
  startup?: StartupPerfSample;
  runtime?: SessionRuntimeHints;
  device?: AgentDeviceSessionDevice;
  identifiers: AgentDeviceIdentifiers;
};

export type AppCloseOptions = AgentDeviceClientConfig & {
  app?: string;
  shutdown?: boolean;
};

export type AppCloseResult = {
  session: string;
  closedApp?: string;
  shutdown?: Record<string, unknown>;
  identifiers: AgentDeviceIdentifiers;
};

export type RuntimeShowOptions = AgentDeviceClientConfig;

export type RuntimeSetOptions = AgentDeviceClientConfig & {
  platform?: PlatformSelector;
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  launchUrl?: string;
};

export type RuntimeResult = {
  session: string;
  configured: boolean;
  cleared?: boolean;
  runtime?: SessionRuntimeHints;
  identifiers: AgentDeviceIdentifiers;
};

export type CaptureSnapshotOptions = AgentDeviceClientConfig & AgentDeviceSelectionOptions & {
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
};

export type CaptureSnapshotResult = {
  nodes: SnapshotNode[];
  truncated: boolean;
  appName?: string;
  appBundleId?: string;
  identifiers: AgentDeviceIdentifiers;
};

export type CaptureScreenshotOptions = AgentDeviceClientConfig & {
  path?: string;
};

export type CaptureScreenshotResult = {
  path: string;
  identifiers: AgentDeviceIdentifiers;
};

type RequestOptions = AgentDeviceClientConfig & AgentDeviceSelectionOptions & {
  runtime?: string;
  boot?: boolean;
  reuseExisting?: boolean;
  activity?: string;
  relaunch?: boolean;
  shutdown?: boolean;
  saveScript?: boolean | string;
  noRecord?: boolean;
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  launchUrl?: string;
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
};

export type AgentDeviceClient = {
  devices: {
    list: (options?: AgentDeviceClientConfig & AgentDeviceSelectionOptions) => Promise<AgentDeviceDevice[]>;
  };
  sessions: {
    list: (options?: AgentDeviceClientConfig) => Promise<AgentDeviceSession[]>;
    close: (options?: AgentDeviceClientConfig & { shutdown?: boolean }) => Promise<SessionCloseResult>;
  };
  simulators: {
    ensure: (options: EnsureSimulatorOptions) => Promise<EnsureSimulatorResult>;
  };
  apps: {
    install: (options: AppDeployOptions) => Promise<AppDeployResult>;
    reinstall: (options: AppDeployOptions) => Promise<AppDeployResult>;
    open: (options: AppOpenOptions) => Promise<AppOpenResult>;
    close: (options?: AppCloseOptions) => Promise<AppCloseResult>;
  };
  runtime: {
    set: (options: RuntimeSetOptions) => Promise<RuntimeResult>;
    show: (options?: RuntimeShowOptions) => Promise<RuntimeResult>;
  };
  capture: {
    snapshot: (options?: CaptureSnapshotOptions) => Promise<CaptureSnapshotResult>;
    screenshot: (options?: CaptureScreenshotOptions) => Promise<CaptureScreenshotResult>;
  };
};

export function createAgentDeviceClient(
  config: AgentDeviceClientConfig = {},
  deps: { transport?: DaemonTransport } = {},
): AgentDeviceClient {
  const transport = deps.transport ?? sendToDaemon;

  const execute = async (
    command: string,
    positionals: string[] = [],
    options: RequestOptions = {},
  ): Promise<Record<string, unknown>> => {
    const merged = { ...config, ...options };
    const response = await transport({
      session: resolveSessionName(config.session, options.session),
      command,
      positionals,
      flags: buildFlags(merged),
      meta: buildMeta(merged),
    });
    if (!response.ok) {
      throw new AppError(response.error.code as any, response.error.message, {
        ...(response.error.details ?? {}),
        hint: response.error.hint,
        diagnosticId: response.error.diagnosticId,
        logPath: response.error.logPath,
      });
    }
    return (response.data ?? {}) as Record<string, unknown>;
  };

  const listSessions = async (options: AgentDeviceClientConfig = {}): Promise<AgentDeviceSession[]> => {
    const data = await execute('session_list', [], options);
    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    return sessions.map(normalizeSession);
  };

  return {
    devices: {
      list: async (options = {}) => {
        const data = await execute('devices', [], options);
        const devices = Array.isArray(data.devices) ? data.devices : [];
        return devices.map(normalizeDevice);
      },
    },
    sessions: {
      list: async (options = {}) => await listSessions(options),
      close: async (options = {}) => {
        const session = resolveSessionName(config.session, options.session);
        const data = await execute('close', [], options);
        return {
          session,
          shutdown: isRecord(data.shutdown) ? data.shutdown : undefined,
          identifiers: { session },
        };
      },
    },
    simulators: {
      ensure: async (options) => {
        const data = await execute('ensure-simulator', [], options);
        const udid = readRequiredString(data, 'udid');
        return {
          udid,
          device: readRequiredString(data, 'device'),
          runtime: readRequiredString(data, 'runtime'),
          created: data.created === true,
          booted: data.booted === true,
          iosSimulatorDeviceSet: readNullableString(data, 'ios_simulator_device_set'),
          identifiers: {
            deviceId: udid,
            deviceName: readRequiredString(data, 'device'),
            udid,
          },
        };
      },
    },
    apps: {
      install: async (options) => normalizeDeployResult(await execute('install', [options.app, options.appPath], options), options),
      reinstall: async (options) => normalizeDeployResult(await execute('reinstall', [options.app, options.appPath], options), options),
      open: async (options) => {
        const session = resolveSessionName(config.session, options.session);
        const positionals = options.url ? [options.app, options.url] : [options.app];
        const data = await execute('open', positionals, options);
        const device = normalizeOpenDevice(data);
        const appBundleId = readOptionalString(data, 'appBundleId');
        const appId = appBundleId;
        return {
          session,
          appName: readOptionalString(data, 'appName'),
          appBundleId,
          appId,
          startup: normalizeStartupSample(data.startup),
          runtime: normalizeRuntimeHints(data.runtime),
          device,
          identifiers: {
            session,
            deviceId: device?.id,
            deviceName: device?.name,
            udid: device?.ios?.udid,
            serial: device?.android?.serial,
            appId,
            appBundleId,
          },
        };
      },
      close: async (options = {}) => {
        const session = resolveSessionName(config.session, options.session);
        const data = await execute('close', options.app ? [options.app] : [], options);
        return {
          session,
          closedApp: options.app,
          shutdown: isRecord(data.shutdown) ? data.shutdown : undefined,
          identifiers: { session },
        };
      },
    },
    runtime: {
      set: async (options) => normalizeRuntimeResult(
        await execute('runtime', ['set'], options),
        resolveSessionName(config.session, options.session),
      ),
      show: async (options = {}) => normalizeRuntimeResult(
        await execute('runtime', ['show'], options),
        resolveSessionName(config.session, options.session),
      ),
    },
    capture: {
      snapshot: async (options = {}) => {
        const session = resolveSessionName(config.session, options.session);
        const data = await execute('snapshot', [], options);
        const appBundleId = readOptionalString(data, 'appBundleId');
        return {
          nodes: readSnapshotNodes(data.nodes),
          truncated: data.truncated === true,
          appName: readOptionalString(data, 'appName'),
          appBundleId,
          identifiers: {
            session,
            appId: appBundleId,
            appBundleId,
          },
        };
      },
      screenshot: async (options = {}) => {
        const session = resolveSessionName(config.session, options.session);
        const data = await execute('screenshot', options.path ? [options.path] : [], options);
        return {
          path: readRequiredString(data, 'path'),
          identifiers: { session },
        };
      },
    },
  };
}

function normalizeDeployResult(
  data: Record<string, unknown>,
  options: AppDeployOptions,
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
      session: options.session,
      appId,
      appBundleId: bundleId,
      package: pkg,
    },
  };
}

function normalizeRuntimeResult(
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

function normalizeDevice(value: unknown): AgentDeviceDevice {
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

function normalizeSession(value: unknown): AgentDeviceSession {
  const record = asRecord(value);
  const platform = readRequiredPlatform(record, 'platform');
  const id = readRequiredString(record, 'id');
  const name = readRequiredString(record, 'name');
  const target = readDeviceTarget(record, 'target');
  const deviceName = readRequiredString(record, 'device');
  const identifiers: AgentDeviceIdentifiers = {
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

function normalizeRuntimeHints(value: unknown): SessionRuntimeHints | undefined {
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

function normalizeOpenDevice(value: Record<string, unknown>): AgentDeviceSessionDevice | undefined {
  const platform = value.platform;
  const id = readOptionalString(value, 'id');
  const name = readOptionalString(value, 'device');
  if ((platform !== 'ios' && platform !== 'android') || !id || !name) {
    return undefined;
  }
  const target = readDeviceTarget(value, 'target');
  const identifiers: AgentDeviceIdentifiers = {
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

function normalizeStartupSample(value: unknown): StartupPerfSample | undefined {
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

function readSnapshotNodes(value: unknown): SnapshotNode[] {
  // Snapshot nodes are produced by the daemon snapshot pipeline and treated as trusted here.
  return Array.isArray(value) ? value as SnapshotNode[] : [];
}

function buildFlags(options: RequestOptions): CommandFlags {
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
    runtime: options.runtime,
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

function buildMeta(options: RequestOptions): DaemonRequest['meta'] {
  return stripUndefined({
    requestId: options.requestId,
    cwd: options.cwd,
    debug: options.debug,
    tenantId: options.tenant,
    runId: options.runId,
    leaseId: options.leaseId,
    sessionIsolation: options.sessionIsolation,
  });
}

function resolveSessionName(defaultSession: string | undefined, session: string | undefined): string {
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

function readRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new AppError('COMMAND_FAILED', `Daemon response is missing "${key}".`, { response: record });
  }
  return value;
}

function readOptionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNullableString(record: Record<string, unknown>, key: string): string | null | undefined {
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
