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

export type BackendOpenTarget = {
  app?: string;
  url?: string;
  activity?: string;
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
  pressKey?(
    context: BackendCommandContext,
    key: string,
    options?: { modifiers?: string[] },
  ): Promise<BackendActionResult>;
  openApp?(context: BackendCommandContext, target: BackendOpenTarget): Promise<BackendActionResult>;
  closeApp?(context: BackendCommandContext, app?: string): Promise<BackendActionResult>;
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
