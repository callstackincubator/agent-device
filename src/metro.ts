import { buildMetroRuntimeHints, prepareMetroRuntime } from './client-metro.ts';
import { ensureMetroCompanion, stopMetroCompanion } from './client-metro-companion.ts';

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
