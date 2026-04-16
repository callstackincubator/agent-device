import type {
  Point,
  ScreenshotOverlayRef,
  SnapshotNode,
  SnapshotOptions,
  SnapshotState,
} from './utils/snapshot.ts';

export type AgentDeviceBackendPlatform = 'ios' | 'android' | 'macos' | 'linux';

export const BACKEND_CAPABILITY_NAMES = [
  'android.shell',
  'ios.runnerCommand',
  'macos.desktopScreenshot',
] as const;

export type BackendCapabilityName = (typeof BACKEND_CAPABILITY_NAMES)[number];

export type BackendCapabilitySet = readonly BackendCapabilityName[];

export type BackendCommandContext = {
  session?: string;
  requestId?: string;
  appId?: string;
  appBundleId?: string;
  signal?: AbortSignal;
  metadata?: Record<string, unknown>;
};

export type BackendSnapshotResult = {
  nodes?: SnapshotNode[];
  truncated?: boolean;
  backend?: string;
  snapshot?: SnapshotState;
  analysis?: BackendSnapshotAnalysis;
  freshness?: BackendSnapshotFreshness;
  warnings?: string[];
  appName?: string;
  appBundleId?: string;
};

export type BackendSnapshotOptions = SnapshotOptions & {
  outPath?: string;
};

export type BackendSnapshotAnalysis = {
  rawNodeCount?: number;
  maxDepth?: number;
};

export type BackendSnapshotFreshness = {
  action: string;
  retryCount: number;
  staleAfterRetries: boolean;
  reason?: 'empty-interactive' | 'sharp-drop' | 'stuck-route';
};

export type BackendReadTextResult = {
  text: string;
};

export type BackendFindTextResult = {
  found: boolean;
};

export type BackendScreenshotOptions = {
  fullscreen?: boolean;
  overlayRefs?: boolean;
  surface?: 'app' | 'frontmost-app' | 'desktop' | 'menubar';
};

export type BackendScreenshotResult = {
  path?: string;
  overlayRefs?: ScreenshotOverlayRef[];
};

export type BackendActionResult = Record<string, unknown> | void;

export type BackendDeviceOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

export type BackendBackOptions = {
  mode?: 'in-app' | 'system';
};

export type BackendKeyboardOptions = {
  action: 'status' | 'get' | 'dismiss';
};

export type BackendKeyboardResult = {
  platform?: 'android' | 'ios' | 'macos' | 'linux';
  action?: BackendKeyboardOptions['action'];
  visible?: boolean;
  inputType?: string | null;
  type?: string | null;
  wasVisible?: boolean;
  dismissed?: boolean;
  attempts?: number;
};

export type BackendClipboardTextResult = {
  text: string;
};

export type BackendAlertAction = 'get' | 'accept' | 'dismiss' | 'wait';

export type BackendAlertInfo = {
  title?: string;
  message?: string;
  buttons?: string[];
};

export type BackendAlertResult =
  | {
      kind: 'alertStatus';
      alert: BackendAlertInfo | null;
    }
  | {
      kind: 'alertHandled';
      handled: boolean;
      alert?: BackendAlertInfo;
      button?: string;
    }
  | {
      kind: 'alertWait';
      alert: BackendAlertInfo | null;
      waitedMs?: number;
      timedOut?: boolean;
    };

export type BackendTapOptions = {
  button?: 'primary' | 'secondary' | 'middle';
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};

export type BackendFillOptions = {
  delayMs?: number;
};

export type BackendLongPressOptions = {
  durationMs?: number;
};

export type BackendSwipeOptions = {
  durationMs?: number;
};

export type BackendScrollTarget =
  | {
      kind: 'viewport';
    }
  | {
      kind: 'point';
      point: Point;
    };

export type BackendScrollOptions = {
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  pixels?: number;
};

export type BackendPinchOptions = {
  scale: number;
  center?: Point;
};

export type BackendOpenTarget = {
  /**
   * Generic app identifier accepted by the backend. Hosted adapters should
   * prefer structured appId, bundleId, or packageName when available.
   */
  app?: string;
  appId?: string;
  bundleId?: string;
  packageName?: string;
  /**
   * URL may be used by itself for a deep link or with an app identifier when
   * the backend supports opening a URL in a specific app context.
   */
  url?: string;
  /**
   * Platform-specific activity override, primarily for Android app launches.
   */
  activity?: string;
};

export type BackendOpenOptions = {
  relaunch?: boolean;
};

export type BackendAppListFilter = 'all' | 'user-installed';

export type BackendAppInfo = {
  id: string;
  name?: string;
  bundleId?: string;
  packageName?: string;
  activity?: string;
};

export type BackendAppState = {
  appId?: string;
  bundleId?: string;
  packageName?: string;
  activity?: string;
  state?: 'unknown' | 'notRunning' | 'running' | 'foreground' | 'background';
  details?: Record<string, unknown>;
};

export type BackendPushInput =
  | {
      kind: 'json';
      payload: Record<string, unknown>;
    }
  | {
      kind: 'file';
      path: string;
    };

export type BackendAppEvent = {
  name: string;
  payload?: Record<string, unknown>;
};

export type BackendInstallTarget = {
  app: string;
  artifactPath: string;
};

export type BackendShellResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type BackendRunnerCommand = {
  command: string;
  args?: readonly string[];
  payload?: Record<string, unknown>;
};

export type BackendEscapeHatches = {
  androidShell?(
    context: BackendCommandContext,
    args: readonly string[],
  ): Promise<BackendShellResult>;
  iosRunnerCommand?(
    context: BackendCommandContext,
    command: BackendRunnerCommand,
  ): Promise<BackendActionResult>;
  macosDesktopScreenshot?(
    context: BackendCommandContext,
    outPath: string,
    options?: BackendScreenshotOptions,
  ): Promise<BackendScreenshotResult | void>;
};

export const BACKEND_CAPABILITY_ESCAPE_HATCH_METHODS = {
  'android.shell': 'androidShell',
  'ios.runnerCommand': 'iosRunnerCommand',
  'macos.desktopScreenshot': 'macosDesktopScreenshot',
} as const satisfies Record<BackendCapabilityName, keyof BackendEscapeHatches>;

export type AgentDeviceBackend = {
  platform: AgentDeviceBackendPlatform;
  capabilities?: BackendCapabilitySet;
  escapeHatches?: BackendEscapeHatches;
  captureSnapshot?(
    context: BackendCommandContext,
    options?: BackendSnapshotOptions,
  ): Promise<BackendSnapshotResult>;
  captureScreenshot?(
    context: BackendCommandContext,
    outPath: string,
    options?: BackendScreenshotOptions,
  ): Promise<BackendScreenshotResult | void>;
  readText?(context: BackendCommandContext, node: SnapshotNode): Promise<BackendReadTextResult>;
  findText?(context: BackendCommandContext, text: string): Promise<BackendFindTextResult>;
  tap?(
    context: BackendCommandContext,
    point: Point,
    options?: BackendTapOptions,
  ): Promise<BackendActionResult>;
  fill?(
    context: BackendCommandContext,
    point: Point,
    text: string,
    options?: BackendFillOptions,
  ): Promise<BackendActionResult>;
  typeText?(
    context: BackendCommandContext,
    text: string,
    options?: { delayMs?: number },
  ): Promise<BackendActionResult>;
  focus?(context: BackendCommandContext, point: Point): Promise<BackendActionResult>;
  longPress?(
    context: BackendCommandContext,
    point: Point,
    options?: BackendLongPressOptions,
  ): Promise<BackendActionResult>;
  swipe?(
    context: BackendCommandContext,
    from: Point,
    to: Point,
    options?: BackendSwipeOptions,
  ): Promise<BackendActionResult>;
  scroll?(
    context: BackendCommandContext,
    target: BackendScrollTarget,
    options: BackendScrollOptions,
  ): Promise<BackendActionResult>;
  pinch?(
    context: BackendCommandContext,
    options: BackendPinchOptions,
  ): Promise<BackendActionResult>;
  pressKey?(
    context: BackendCommandContext,
    key: string,
    options?: { modifiers?: string[] },
  ): Promise<BackendActionResult>;
  pressBack?(
    context: BackendCommandContext,
    options?: BackendBackOptions,
  ): Promise<BackendActionResult>;
  pressHome?(context: BackendCommandContext): Promise<BackendActionResult>;
  rotate?(
    context: BackendCommandContext,
    orientation: BackendDeviceOrientation,
  ): Promise<BackendActionResult>;
  setKeyboard?(
    context: BackendCommandContext,
    options: BackendKeyboardOptions,
  ): Promise<BackendKeyboardResult | BackendActionResult>;
  getClipboard?(context: BackendCommandContext): Promise<string | BackendClipboardTextResult>;
  setClipboard?(context: BackendCommandContext, text: string): Promise<BackendActionResult>;
  openSettings?(context: BackendCommandContext, target?: string): Promise<BackendActionResult>;
  handleAlert?(
    context: BackendCommandContext,
    action: BackendAlertAction,
    options?: { timeoutMs?: number },
  ): Promise<BackendAlertResult>;
  openAppSwitcher?(context: BackendCommandContext): Promise<BackendActionResult>;
  openApp?(
    context: BackendCommandContext,
    target: BackendOpenTarget,
    options?: BackendOpenOptions,
  ): Promise<BackendActionResult>;
  closeApp?(context: BackendCommandContext, app?: string): Promise<BackendActionResult>;
  listApps?(
    context: BackendCommandContext,
    filter?: BackendAppListFilter,
  ): Promise<readonly BackendAppInfo[]>;
  getAppState?(context: BackendCommandContext, app: string): Promise<BackendAppState>;
  pushFile?(
    context: BackendCommandContext,
    input: BackendPushInput,
    target: string,
  ): Promise<BackendActionResult>;
  triggerAppEvent?(
    context: BackendCommandContext,
    event: BackendAppEvent,
  ): Promise<BackendActionResult>;
  installApp?(
    context: BackendCommandContext,
    target: BackendInstallTarget,
  ): Promise<BackendActionResult>;
};

export function hasBackendCapability(
  backend: Pick<AgentDeviceBackend, 'platform' | 'capabilities'>,
  capability: BackendCapabilityName,
): boolean {
  return backend.capabilities?.includes(capability) ?? false;
}

export function hasBackendEscapeHatch(
  backend: Pick<AgentDeviceBackend, 'escapeHatches'>,
  capability: BackendCapabilityName,
): boolean {
  const method = BACKEND_CAPABILITY_ESCAPE_HATCH_METHODS[capability];
  return typeof backend.escapeHatches?.[method] === 'function';
}
