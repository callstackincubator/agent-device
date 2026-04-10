import {
  buildMetroRuntimeHints,
  prepareMetroRuntime,
  type MetroBridgeResult,
  type MetroRuntimeHints,
  type PrepareRemoteMetroOptions,
  type PrepareMetroRuntimeResult,
} from './client-metro.ts';
import {
  ensureMetroCompanion,
  stopMetroCompanion,
  type EnsureMetroCompanionOptions,
  type EnsureMetroCompanionResult,
  type StopMetroCompanionOptions,
} from './client-metro-companion.ts';

export type {
  MetroBridgeResult,
  MetroRuntimeHints,
  PrepareRemoteMetroOptions,
  PrepareMetroRuntimeResult,
  EnsureMetroCompanionOptions as EnsureMetroTunnelOptions,
  EnsureMetroCompanionResult as EnsureMetroTunnelResult,
  StopMetroCompanionOptions as StopMetroTunnelOptions,
};

export async function prepareRemoteMetro(
  options: PrepareRemoteMetroOptions,
): Promise<PrepareMetroRuntimeResult> {
  return await prepareMetroRuntime({
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
}

export async function ensureMetroTunnel(
  options: EnsureMetroCompanionOptions,
): Promise<EnsureMetroCompanionResult> {
  return await ensureMetroCompanion(options);
}

export async function stopMetroTunnel(options: StopMetroCompanionOptions): Promise<void> {
  await stopMetroCompanion(options);
}

export function buildIosRuntimeHints(baseUrl: string): MetroRuntimeHints {
  return buildMetroRuntimeHints(baseUrl, 'ios');
}

export function buildAndroidRuntimeHints(baseUrl: string): MetroRuntimeHints {
  return buildMetroRuntimeHints(baseUrl, 'android');
}
