import type {
  DaemonInstallSource,
  DaemonLockPolicy,
  DaemonRequest,
  DaemonResponse,
  SessionRuntimeHints,
} from './daemon/types.ts';
import type { DeviceKind, DeviceTarget, Platform, PlatformSelector } from './utils/device.ts';
import type { ScreenshotOverlayRef, SnapshotNode } from './utils/snapshot.ts';
import type { MetroPrepareKind, PrepareMetroRuntimeResult } from './client-metro.ts';

type DaemonTransportMode = 'auto' | 'socket' | 'http';
type DaemonServerMode = 'socket' | 'http' | 'dual';
type SessionIsolationMode = 'none' | 'tenant';

export type AgentDeviceDaemonTransport = (
  req: Omit<DaemonRequest, 'token'>,
) => Promise<DaemonResponse>;

export type AgentDeviceClientConfig = {
  session?: string;
  lockPolicy?: DaemonLockPolicy;
  lockPlatform?: PlatformSelector;
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

export type AgentDeviceRequestOverrides = Pick<
  AgentDeviceClientConfig,
  | 'session'
  | 'lockPolicy'
  | 'lockPlatform'
  | 'requestId'
  | 'tenant'
  | 'sessionIsolation'
  | 'runId'
  | 'leaseId'
  | 'cwd'
  | 'debug'
>;

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

export type EnsureSimulatorOptions = AgentDeviceRequestOverrides & {
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

export type AppDeployOptions = AgentDeviceRequestOverrides &
  AgentDeviceSelectionOptions & {
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

export type AppOpenOptions = AgentDeviceRequestOverrides &
  AgentDeviceSelectionOptions & {
    app: string;
    url?: string;
    surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
    activity?: string;
    relaunch?: boolean;
    saveScript?: boolean | string;
    noRecord?: boolean;
    runtime?: SessionRuntimeHints;
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

export type AppCloseOptions = AgentDeviceRequestOverrides & {
  app?: string;
  shutdown?: boolean;
};

export type AppCloseResult = {
  session: string;
  closedApp?: string;
  shutdown?: Record<string, unknown>;
  identifiers: AgentDeviceIdentifiers;
};

export type AppInstallFromSourceOptions = AgentDeviceRequestOverrides &
  AgentDeviceSelectionOptions & {
    source: DaemonInstallSource;
    retainPaths?: boolean;
    retentionMs?: number;
  };

export type AppInstallFromSourceResult = {
  appName?: string;
  appId?: string;
  bundleId?: string;
  packageName?: string;
  launchTarget: string;
  installablePath?: string;
  archivePath?: string;
  materializationId?: string;
  materializationExpiresAt?: string;
  identifiers: AgentDeviceIdentifiers;
};

export type MaterializationReleaseOptions = AgentDeviceRequestOverrides & {
  materializationId: string;
};

export type MaterializationReleaseResult = {
  released: boolean;
  materializationId: string;
  identifiers: AgentDeviceIdentifiers;
};

export type MetroPrepareOptions = {
  projectRoot?: string;
  kind?: MetroPrepareKind;
  publicBaseUrl: string;
  proxyBaseUrl?: string;
  bearerToken?: string;
  port?: number;
  listenHost?: string;
  statusHost?: string;
  startupTimeoutMs?: number;
  probeTimeoutMs?: number;
  reuseExisting?: boolean;
  installDependenciesIfNeeded?: boolean;
  runtimeFilePath?: string;
  logPath?: string;
};

export type MetroPrepareResult = PrepareMetroRuntimeResult;

export type CaptureSnapshotOptions = AgentDeviceRequestOverrides &
  AgentDeviceSelectionOptions & {
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

export type CaptureScreenshotOptions = AgentDeviceRequestOverrides & {
  path?: string;
  overlayRefs?: boolean;
};

export type CaptureScreenshotResult = {
  path: string;
  overlayRefs?: ScreenshotOverlayRef[];
  identifiers: AgentDeviceIdentifiers;
};

export type InternalRequestOptions = AgentDeviceClientConfig &
  AgentDeviceSelectionOptions & {
    simulatorRuntimeId?: string;
    runtime?: SessionRuntimeHints;
    overlayRefs?: boolean;
    boot?: boolean;
    reuseExisting?: boolean;
    surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
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
    installSource?: DaemonInstallSource;
    retainMaterializedPaths?: boolean;
    materializedPathRetentionMs?: number;
    materializationId?: string;
  };

export type AgentDeviceClient = {
  devices: {
    list: (
      options?: AgentDeviceRequestOverrides & AgentDeviceSelectionOptions,
    ) => Promise<AgentDeviceDevice[]>;
  };
  sessions: {
    list: (options?: AgentDeviceRequestOverrides) => Promise<AgentDeviceSession[]>;
    close: (
      options?: AgentDeviceRequestOverrides & { shutdown?: boolean },
    ) => Promise<SessionCloseResult>;
  };
  simulators: {
    ensure: (options: EnsureSimulatorOptions) => Promise<EnsureSimulatorResult>;
  };
  apps: {
    install: (options: AppDeployOptions) => Promise<AppDeployResult>;
    reinstall: (options: AppDeployOptions) => Promise<AppDeployResult>;
    installFromSource: (
      options: AppInstallFromSourceOptions,
    ) => Promise<AppInstallFromSourceResult>;
    open: (options: AppOpenOptions) => Promise<AppOpenResult>;
    close: (options?: AppCloseOptions) => Promise<AppCloseResult>;
  };
  materializations: {
    release: (options: MaterializationReleaseOptions) => Promise<MaterializationReleaseResult>;
  };
  metro: {
    prepare: (options: MetroPrepareOptions) => Promise<MetroPrepareResult>;
  };
  capture: {
    snapshot: (options?: CaptureSnapshotOptions) => Promise<CaptureSnapshotResult>;
    screenshot: (options?: CaptureScreenshotOptions) => Promise<CaptureScreenshotResult>;
  };
};
