import { buildMetroRuntimeHints, prepareMetroRuntime } from './client-metro.ts';
import { ensureMetroCompanion, stopMetroCompanion } from './client-metro-companion.ts';
export { buildBundleUrl, normalizeBaseUrl } from './utils/url.ts';

type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

// Keep this public shape aligned with SessionRuntimeHints in src/contracts.ts and the
// internal MetroRuntimeHints in src/client-metro.ts.
export type MetroRuntimeHints = {
  platform?: 'ios' | 'android';
  metroHost?: string;
  metroPort?: number;
  bundleUrl?: string;
  launchUrl?: string;
};

export type MetroBridgeResult = {
  enabled: boolean;
  baseUrl: string;
  statusUrl: string;
  bundleUrl: string;
  iosRuntime: MetroRuntimeHints;
  androidRuntime: MetroRuntimeHints;
  upstream: {
    bundleUrl: string;
    host: string;
    port: number;
    statusUrl: string;
  };
  probe: {
    reachable: boolean;
    statusCode: number;
    latencyMs: number;
    detail: string;
  };
};

export type MetroBridgeRuntimePayload = {
  metro_host?: string;
  metro_port?: number;
  metro_bundle_url?: string;
  launch_url?: string;
};

export type MetroBridgeDescriptor = {
  enabled: boolean;
  base_url: string;
  status_url: string;
  bundle_url: string;
  ios_runtime: MetroBridgeRuntimePayload;
  android_runtime: MetroBridgeRuntimePayload;
  upstream: {
    bundle_url: string;
    host: string;
    port: number;
    status_url: string;
  };
  probe: {
    reachable: boolean;
    status_code: number;
    latency_ms: number;
    detail: string;
  };
};

export type MetroTunnelPingMessage = {
  type: 'ping';
  timestamp: number;
};

export type MetroTunnelPongMessage = {
  type: 'pong';
  timestamp: number;
};

export type MetroTunnelHttpRequestMessage = {
  type: 'http-request';
  requestId: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
};

export type MetroTunnelHttpResponseMessage = {
  type: 'http-response';
  requestId: string;
  status: number;
  headers: Record<string, string>;
  bodyBase64?: string;
};

export type MetroTunnelHttpErrorMessage = {
  type: 'http-error';
  requestId: string;
  message: string;
};

export type MetroTunnelWebSocketOpenMessage = {
  type: 'ws-open';
  streamId: string;
  path: string;
  headers?: Record<string, string>;
};

export type MetroTunnelWebSocketOpenResultMessage = {
  type: 'ws-open-result';
  streamId: string;
  success: boolean;
  headers?: Record<string, string>;
  error?: string;
};

export type MetroTunnelWebSocketFrameMessage = {
  type: 'ws-frame';
  streamId: string;
  dataBase64: string;
  binary: boolean;
};

export type MetroTunnelWebSocketCloseMessage = {
  type: 'ws-close';
  streamId: string;
  code?: number;
  reason?: string;
};

export type MetroTunnelRequestMessage =
  | MetroTunnelPingMessage
  | MetroTunnelHttpRequestMessage
  | MetroTunnelWebSocketOpenMessage
  | MetroTunnelWebSocketFrameMessage
  | MetroTunnelWebSocketCloseMessage;

export type MetroTunnelResponseMessage =
  | MetroTunnelPongMessage
  | MetroTunnelHttpResponseMessage
  | MetroTunnelHttpErrorMessage
  | MetroTunnelWebSocketOpenResultMessage
  | MetroTunnelWebSocketFrameMessage
  | MetroTunnelWebSocketCloseMessage;

export type MetroTunnelMessage = MetroTunnelRequestMessage | MetroTunnelResponseMessage;

export type PrepareRemoteMetroOptions = {
  projectRoot: string;
  kind: 'auto' | 'react-native' | 'expo';
  publicBaseUrl: string;
  proxyBaseUrl?: string;
  proxyBearerToken?: string;
  launchUrl?: string;
  profileKey?: string;
  consumerKey?: string;
  port?: number;
  listenHost?: string;
  statusHost?: string;
  startupTimeoutMs?: number;
  probeTimeoutMs?: number;
  reuseExisting?: boolean;
  installDependenciesIfNeeded?: boolean;
  runtimeFilePath?: string;
  logPath?: string;
  env?: EnvSource;
};

export type PrepareRemoteMetroResult = {
  iosRuntime: MetroRuntimeHints;
  androidRuntime: MetroRuntimeHints;
  bridge: MetroBridgeResult | null;
  started: boolean;
  reused: boolean;
  logPath: string;
};

export type EnsureMetroTunnelOptions = {
  projectRoot: string;
  serverBaseUrl: string;
  bearerToken: string;
  localBaseUrl: string;
  launchUrl?: string;
  profileKey?: string;
  consumerKey?: string;
  env?: EnvSource;
};

export type EnsureMetroTunnelResult = {
  pid: number;
  started: boolean;
  logPath: string;
};

export type StopMetroTunnelOptions = {
  projectRoot: string;
  profileKey?: string;
  consumerKey?: string;
};

export async function prepareRemoteMetro(
  options: PrepareRemoteMetroOptions,
): Promise<PrepareRemoteMetroResult> {
  const prepared = await prepareMetroRuntime({
    projectRoot: options.projectRoot,
    kind: options.kind,
    publicBaseUrl: options.publicBaseUrl,
    proxyBaseUrl: options.proxyBaseUrl,
    proxyBearerToken: options.proxyBearerToken,
    launchUrl: options.launchUrl,
    companionProfileKey: options.profileKey,
    companionConsumerKey: options.consumerKey,
    metroPort: options.port,
    listenHost: options.listenHost,
    statusHost: options.statusHost,
    startupTimeoutMs: options.startupTimeoutMs,
    probeTimeoutMs: options.probeTimeoutMs,
    reuseExisting: options.reuseExisting,
    installDependenciesIfNeeded: options.installDependenciesIfNeeded,
    runtimeFilePath: options.runtimeFilePath,
    logPath: options.logPath,
    env: options.env,
  });
  return {
    iosRuntime: prepared.iosRuntime,
    androidRuntime: prepared.androidRuntime,
    bridge: prepared.bridge,
    started: prepared.started,
    reused: prepared.reused,
    logPath: prepared.logPath,
  };
}

export async function ensureMetroTunnel(
  options: EnsureMetroTunnelOptions,
): Promise<EnsureMetroTunnelResult> {
  const ensured = await ensureMetroCompanion(options);
  return {
    pid: ensured.pid,
    started: ensured.spawned,
    logPath: ensured.logPath,
  };
}

export async function stopMetroTunnel(options: StopMetroTunnelOptions): Promise<void> {
  await stopMetroCompanion(options);
}

export function buildIosRuntimeHints(baseUrl: string): MetroRuntimeHints {
  return buildMetroRuntimeHints(baseUrl, 'ios');
}

export function buildAndroidRuntimeHints(baseUrl: string): MetroRuntimeHints {
  return buildMetroRuntimeHints(baseUrl, 'android');
}
