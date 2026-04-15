import type {
  DaemonResponseData,
  DaemonInstallSource,
  DaemonLockPolicy,
  DaemonRequest,
  DaemonResponse,
  LeaseBackend,
  SessionRuntimeHints,
} from './contracts.ts';
import type { DeviceKind, DeviceTarget, Platform, PlatformSelector } from './utils/device.ts';
import type { ScreenshotOverlayRef, SnapshotNode, SnapshotVisibility } from './utils/snapshot.ts';
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
  leaseBackend?: LeaseBackend;
  runtime?: SessionRuntimeHints;
  cwd?: string;
  debug?: boolean;
};

export type AgentDeviceRequestOverrides = Pick<
  AgentDeviceClientConfig,
  | 'session'
  | 'lockPolicy'
  | 'lockPlatform'
  | 'requestId'
  | 'daemonBaseUrl'
  | 'daemonAuthToken'
  | 'daemonTransport'
  | 'daemonServerMode'
  | 'tenant'
  | 'sessionIsolation'
  | 'runId'
  | 'leaseId'
  | 'leaseBackend'
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
    app?: string;
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

export type AppListOptions = AgentDeviceRequestOverrides &
  AgentDeviceSelectionOptions & {
    appsFilter?: 'all' | 'user-installed';
  };

export type MaterializationReleaseOptions = AgentDeviceRequestOverrides & {
  materializationId: string;
};

export type MaterializationReleaseResult = {
  released: boolean;
  materializationId: string;
  identifiers: AgentDeviceIdentifiers;
};

export type Lease = {
  leaseId: string;
  tenantId: string;
  runId: string;
  backend: LeaseBackend;
  createdAt?: number;
  heartbeatAt?: number;
  expiresAt?: number;
};

export type LeaseOptions = AgentDeviceRequestOverrides & {
  ttlMs?: number;
};

export type LeaseAllocateOptions = LeaseOptions & {
  tenant: string;
  runId: string;
  leaseBackend?: LeaseBackend;
};

export type LeaseScopedOptions = LeaseOptions & {
  tenant?: string;
  runId?: string;
  leaseId: string;
};

export type MetroPrepareOptions = {
  projectRoot?: string;
  kind?: MetroPrepareKind;
  publicBaseUrl: string;
  proxyBaseUrl?: string;
  bearerToken?: string;
  bridgeScope?: {
    tenantId: string;
    runId: string;
    leaseId: string;
  };
  launchUrl?: string;
  companionProfileKey?: string;
  companionConsumerKey?: string;
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
  visibility?: SnapshotVisibility;
  warnings?: string[];
  identifiers: AgentDeviceIdentifiers;
};

export type CaptureScreenshotOptions = AgentDeviceRequestOverrides & {
  path?: string;
  overlayRefs?: boolean;
  fullscreen?: boolean;
  surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
};

export type CaptureScreenshotResult = {
  path: string;
  overlayRefs?: ScreenshotOverlayRef[];
  identifiers: AgentDeviceIdentifiers;
};

export type DeviceCommandBaseOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions;

type WaitSnapshotOptions = Pick<CaptureSnapshotOptions, 'depth' | 'scope' | 'raw'>;

type WaitCommandTarget =
  | {
      durationMs: number;
      text?: never;
      ref?: never;
      selector?: never;
      timeoutMs?: never;
    }
  | (WaitSnapshotOptions & {
      text: string;
      durationMs?: never;
      ref?: never;
      selector?: never;
      timeoutMs?: number;
    })
  | (WaitSnapshotOptions & {
      ref: string;
      durationMs?: never;
      text?: never;
      selector?: never;
      timeoutMs?: number;
    })
  | (WaitSnapshotOptions & {
      selector: string;
      durationMs?: never;
      text?: never;
      ref?: never;
      timeoutMs?: number;
    });

export type WaitCommandOptions = DeviceCommandBaseOptions & WaitCommandTarget;

export type AlertCommandOptions = DeviceCommandBaseOptions & {
  action?: 'get' | 'accept' | 'dismiss' | 'wait';
  timeoutMs?: number;
};

export type AppStateCommandOptions = DeviceCommandBaseOptions;

export type BackCommandOptions = DeviceCommandBaseOptions & {
  mode?: 'in-app' | 'system';
};

export type HomeCommandOptions = DeviceCommandBaseOptions;

export type RotateCommandOptions = DeviceCommandBaseOptions & {
  orientation: 'portrait' | 'portrait-upside-down' | 'landscape-left' | 'landscape-right';
};

export type AppSwitcherCommandOptions = DeviceCommandBaseOptions;

export type KeyboardCommandOptions = DeviceCommandBaseOptions & {
  action?: 'status' | 'dismiss';
};

export type ClipboardCommandOptions =
  | (DeviceCommandBaseOptions & {
      action: 'read';
    })
  | (DeviceCommandBaseOptions & {
      action: 'write';
      text: string;
    });

export type WaitCommandResult = DaemonResponseData & {
  waitedMs?: number;
  text?: string;
  selector?: string;
};

export type AlertCommandResult = DaemonResponseData;

type CommandActionResult<T extends string> = DaemonResponseData & {
  action?: T;
};

export type AppStateCommandResult = DaemonResponseData & {
  platform?: Platform;
  appName?: string;
  appBundleId?: string;
  package?: string;
  activity?: string;
  source?: 'session';
  surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
};

export type BackCommandResult = CommandActionResult<'back'> & {
  mode?: 'in-app' | 'system';
};

export type HomeCommandResult = CommandActionResult<'home'>;

export type RotateCommandResult = CommandActionResult<'rotate'> & {
  orientation?: RotateCommandOptions['orientation'];
};

export type AppSwitcherCommandResult = CommandActionResult<'app-switcher'>;

export type KeyboardCommandResult = DaemonResponseData & {
  platform?: 'android' | 'ios';
  action?: 'status' | 'dismiss';
  visible?: boolean;
  inputType?: string | null;
  type?: string | null;
  wasVisible?: boolean;
  dismissed?: boolean;
  attempts?: number;
};

export type ClipboardCommandResult =
  | (DaemonResponseData & {
      action: 'read';
      text: string;
    })
  | (DaemonResponseData & {
      action: 'write';
      textLength: number;
    });

export type AgentDeviceCommandClient = {
  wait: (options: WaitCommandOptions) => Promise<WaitCommandResult>;
  alert: (options?: AlertCommandOptions) => Promise<AlertCommandResult>;
  appState: (options?: AppStateCommandOptions) => Promise<AppStateCommandResult>;
  back: (options?: BackCommandOptions) => Promise<BackCommandResult>;
  home: (options?: HomeCommandOptions) => Promise<HomeCommandResult>;
  rotate: (options: RotateCommandOptions) => Promise<RotateCommandResult>;
  appSwitcher: (options?: AppSwitcherCommandOptions) => Promise<AppSwitcherCommandResult>;
  keyboard: (options?: KeyboardCommandOptions) => Promise<KeyboardCommandResult>;
  clipboard: (options: ClipboardCommandOptions) => Promise<ClipboardCommandResult>;
};

type SelectorSnapshotCommandOptions = Pick<CaptureSnapshotOptions, 'depth' | 'scope' | 'raw'>;
type FindSnapshotCommandOptions = Pick<CaptureSnapshotOptions, 'depth' | 'raw'>;

type ClientCommandBaseOptions = AgentDeviceRequestOverrides & AgentDeviceSelectionOptions;

type PointTarget = {
  x: number;
  y: number;
  ref?: never;
  selector?: never;
  label?: never;
};

type RefTarget = {
  ref: string;
  label?: string;
  x?: never;
  y?: never;
  selector?: never;
};

type SelectorTarget = {
  selector: string;
  x?: never;
  y?: never;
  ref?: never;
  label?: never;
};

export type InteractionTarget = PointTarget | RefTarget | SelectorTarget;

export type ElementTarget = RefTarget | SelectorTarget;

type RepeatedPressOptions = {
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};

export type DeviceBootOptions = ClientCommandBaseOptions & {
  headless?: boolean;
};

export type AppPushOptions = ClientCommandBaseOptions & {
  app: string;
  payload: string | Record<string, unknown>;
};

export type AppTriggerEventOptions = ClientCommandBaseOptions & {
  event: string;
  payload?: Record<string, unknown>;
};

export type CaptureDiffOptions = ClientCommandBaseOptions &
  Pick<CaptureSnapshotOptions, 'interactiveOnly' | 'compact' | 'depth' | 'scope' | 'raw'> & {
    kind: 'snapshot';
    out?: string;
  };

export type ClickOptions = ClientCommandBaseOptions &
  SelectorSnapshotCommandOptions &
  InteractionTarget &
  RepeatedPressOptions & {
    button?: 'primary' | 'secondary' | 'middle';
  };

export type PressOptions = ClientCommandBaseOptions &
  SelectorSnapshotCommandOptions &
  InteractionTarget &
  RepeatedPressOptions;

export type LongPressOptions = ClientCommandBaseOptions & {
  x: number;
  y: number;
  durationMs?: number;
};

export type SwipeOptions = ClientCommandBaseOptions & {
  from: { x: number; y: number };
  to: { x: number; y: number };
  durationMs?: number;
  count?: number;
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
};

export type FocusOptions = ClientCommandBaseOptions & {
  x: number;
  y: number;
};

export type TypeTextOptions = ClientCommandBaseOptions & {
  text: string;
  delayMs?: number;
};

export type FillOptions = ClientCommandBaseOptions &
  SelectorSnapshotCommandOptions &
  InteractionTarget & {
    text: string;
    delayMs?: number;
  };

export type ScrollOptions = ClientCommandBaseOptions & {
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  pixels?: number;
};

export type PinchOptions = ClientCommandBaseOptions & {
  scale: number;
  x?: number;
  y?: number;
};

export type GetOptions = ClientCommandBaseOptions &
  SelectorSnapshotCommandOptions &
  ElementTarget & {
    format: 'text' | 'attrs';
  };

type IsTextPredicateOptions = ClientCommandBaseOptions &
  SelectorSnapshotCommandOptions & {
    predicate: 'text';
    selector: string;
    value: string;
  };

type IsStatePredicateOptions = ClientCommandBaseOptions &
  SelectorSnapshotCommandOptions & {
    predicate: 'visible' | 'hidden' | 'exists' | 'editable' | 'selected';
    selector: string;
    value?: never;
  };

export type IsOptions = IsTextPredicateOptions | IsStatePredicateOptions;

export type FindLocator = 'any' | 'text' | 'label' | 'value' | 'role' | 'id';

type FindBaseOptions = ClientCommandBaseOptions &
  FindSnapshotCommandOptions & {
    locator?: FindLocator;
    query: string;
    first?: boolean;
    last?: boolean;
  };

export type FindOptions =
  | (FindBaseOptions & { action?: 'click' | 'focus' | 'exists' | 'getText' | 'getAttrs' })
  | (FindBaseOptions & { action: 'wait'; timeoutMs?: number })
  | (FindBaseOptions & { action: 'fill' | 'type'; value: string });

export type ReplayRunOptions = AgentDeviceRequestOverrides & {
  path: string;
  update?: boolean;
};

export type ReplayTestOptions = AgentDeviceRequestOverrides &
  AgentDeviceSelectionOptions & {
    paths: string[];
    update?: boolean;
    failFast?: boolean;
    timeoutMs?: number;
    retries?: number;
    artifactsDir?: string;
    reportJunit?: string;
  };

export type BatchStep = {
  command: string;
  positionals?: string[];
  flags?: Record<string, unknown>;
};

export type BatchRunOptions = AgentDeviceRequestOverrides & {
  steps: BatchStep[];
  onError?: 'stop';
  maxSteps?: number;
  out?: string;
};

export type PerfOptions = ClientCommandBaseOptions;

export type LogsOptions = AgentDeviceRequestOverrides & {
  action?: 'path' | 'start' | 'stop' | 'doctor' | 'mark' | 'clear';
  message?: string;
  restart?: boolean;
};

export type NetworkOptions = AgentDeviceRequestOverrides & {
  action?: 'dump' | 'log';
  limit?: number;
  include?: 'summary' | 'headers' | 'body' | 'all';
};

type RecordingQuality = 5 | 6 | 7 | 8 | 9 | 10;

export type RecordOptions = AgentDeviceRequestOverrides & {
  action: 'start' | 'stop';
  path?: string;
  fps?: number;
  quality?: RecordingQuality;
  hideTouches?: boolean;
};

export type TraceOptions = AgentDeviceRequestOverrides & {
  action: 'start' | 'stop';
  path?: string;
};

export type PermissionTarget =
  | 'camera'
  | 'microphone'
  | 'photos'
  | 'contacts'
  | 'contacts-limited'
  | 'notifications'
  | 'calendar'
  | 'location'
  | 'location-always'
  | 'media-library'
  | 'motion'
  | 'reminders'
  | 'siri'
  | 'accessibility'
  | 'screen-recording'
  | 'input-monitoring';

export type SettingsUpdateOptions =
  | (ClientCommandBaseOptions & {
      setting: 'wifi' | 'airplane' | 'location';
      state: 'on' | 'off';
    })
  | (ClientCommandBaseOptions & {
      setting: 'appearance';
      state: 'light' | 'dark' | 'toggle';
    })
  | (ClientCommandBaseOptions & {
      setting: 'faceid' | 'touchid';
      state: 'match' | 'nonmatch' | 'enroll' | 'unenroll';
    })
  | (ClientCommandBaseOptions & {
      setting: 'fingerprint';
      state: 'match' | 'nonmatch';
    })
  | (ClientCommandBaseOptions & {
      setting: 'permission';
      state: 'grant' | 'deny' | 'reset';
      permission: PermissionTarget;
      mode?: 'full' | 'limited';
    });

type CommandExecutionOptions = {
  positionals?: string[];
  out?: string;
  interactiveOnly?: boolean;
  compact?: boolean;
  depth?: number;
  scope?: string;
  raw?: boolean;
  screenshotFullscreen?: boolean;
  count?: number;
  fps?: number;
  quality?: RecordingQuality;
  hideTouches?: boolean;
  intervalMs?: number;
  delayMs?: number;
  holdMs?: number;
  jitterPx?: number;
  pixels?: number;
  doubleTap?: boolean;
  clickButton?: 'primary' | 'secondary' | 'middle';
  pauseMs?: number;
  pattern?: 'one-way' | 'ping-pong';
  headless?: boolean;
  restart?: boolean;
  replayUpdate?: boolean;
  failFast?: boolean;
  timeoutMs?: number;
  retries?: number;
  artifactsDir?: string;
  reportJunit?: string;
  findFirst?: boolean;
  findLast?: boolean;
  networkInclude?: 'summary' | 'headers' | 'body' | 'all';
  batchOnError?: 'stop';
  batchMaxSteps?: number;
  batchSteps?: Array<{
    command: string;
    positionals?: string[];
    flags?: Record<string, unknown>;
  }>;
};

export type InternalRequestOptions = AgentDeviceClientConfig &
  AgentDeviceSelectionOptions &
  CommandExecutionOptions & {
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
    backMode?: 'in-app' | 'system';
    metroHost?: string;
    metroPort?: number;
    bundleUrl?: string;
    launchUrl?: string;
    appsFilter?: 'all' | 'user-installed';
    installSource?: DaemonInstallSource;
    retainMaterializedPaths?: boolean;
    materializedPathRetentionMs?: number;
    materializationId?: string;
    leaseTtlMs?: number;
  };

export type CommandRequestResult = DaemonResponseData;

export type AgentDeviceClient = {
  command: AgentDeviceCommandClient;
  devices: {
    list: (
      options?: AgentDeviceRequestOverrides & AgentDeviceSelectionOptions,
    ) => Promise<AgentDeviceDevice[]>;
    boot: (options?: DeviceBootOptions) => Promise<CommandRequestResult>;
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
    list: (options?: AppListOptions) => Promise<string[]>;
    open: (options: AppOpenOptions) => Promise<AppOpenResult>;
    close: (options?: AppCloseOptions) => Promise<AppCloseResult>;
    push: (options: AppPushOptions) => Promise<CommandRequestResult>;
    triggerEvent: (options: AppTriggerEventOptions) => Promise<CommandRequestResult>;
  };
  materializations: {
    release: (options: MaterializationReleaseOptions) => Promise<MaterializationReleaseResult>;
  };
  leases: {
    allocate: (options: LeaseAllocateOptions) => Promise<Lease>;
    heartbeat: (options: LeaseScopedOptions) => Promise<Lease>;
    release: (options: LeaseScopedOptions) => Promise<{ released: boolean }>;
  };
  metro: {
    prepare: (options: MetroPrepareOptions) => Promise<MetroPrepareResult>;
  };
  capture: {
    snapshot: (options?: CaptureSnapshotOptions) => Promise<CaptureSnapshotResult>;
    screenshot: (options?: CaptureScreenshotOptions) => Promise<CaptureScreenshotResult>;
    diff: (options: CaptureDiffOptions) => Promise<CommandRequestResult>;
  };
  interactions: {
    click: (options: ClickOptions) => Promise<CommandRequestResult>;
    press: (options: PressOptions) => Promise<CommandRequestResult>;
    longPress: (options: LongPressOptions) => Promise<CommandRequestResult>;
    swipe: (options: SwipeOptions) => Promise<CommandRequestResult>;
    focus: (options: FocusOptions) => Promise<CommandRequestResult>;
    type: (options: TypeTextOptions) => Promise<CommandRequestResult>;
    fill: (options: FillOptions) => Promise<CommandRequestResult>;
    scroll: (options: ScrollOptions) => Promise<CommandRequestResult>;
    pinch: (options: PinchOptions) => Promise<CommandRequestResult>;
    get: (options: GetOptions) => Promise<CommandRequestResult>;
    is: (options: IsOptions) => Promise<CommandRequestResult>;
    find: (options: FindOptions) => Promise<CommandRequestResult>;
  };
  replay: {
    run: (options: ReplayRunOptions) => Promise<CommandRequestResult>;
    test: (options: ReplayTestOptions) => Promise<CommandRequestResult>;
  };
  batch: {
    run: (options: BatchRunOptions) => Promise<CommandRequestResult>;
  };
  observability: {
    perf: (options?: PerfOptions) => Promise<CommandRequestResult>;
    logs: (options?: LogsOptions) => Promise<CommandRequestResult>;
    network: (options?: NetworkOptions) => Promise<CommandRequestResult>;
  };
  recording: {
    record: (options: RecordOptions) => Promise<CommandRequestResult>;
    trace: (options: TraceOptions) => Promise<CommandRequestResult>;
  };
  settings: {
    update: (options: SettingsUpdateOptions) => Promise<CommandRequestResult>;
  };
};
