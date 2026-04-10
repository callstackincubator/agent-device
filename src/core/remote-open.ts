import type { AgentDeviceClient } from '../client.ts';
import { resolveRemoteConfigPath } from '../remote-config.ts';
import type { CliFlags } from '../utils/command-schema.ts';
import { AppError } from '../utils/errors.ts';

export async function resolveRemoteOpenRuntime(
  flags: CliFlags,
  client: AgentDeviceClient,
): Promise<
  | {
      platform?: 'ios' | 'android';
      metroHost?: string;
      metroPort?: number;
      bundleUrl?: string;
      launchUrl?: string;
    }
  | undefined
> {
  if (!flags.remoteConfig) return undefined;
  const platform = flags.platform;
  if (platform !== 'ios' && platform !== 'android') {
    throw new AppError(
      'INVALID_ARGS',
      'open --remote-config requires platform "ios" or "android" in the remote config file or CLI flags.',
    );
  }
  if (!flags.metroPublicBaseUrl) {
    throw new AppError(
      'INVALID_ARGS',
      'open --remote-config requires "metroPublicBaseUrl" in the remote config file.',
    );
  }
  const prepared = await client.metro.prepare({
    projectRoot: flags.metroProjectRoot,
    kind: flags.metroKind,
    publicBaseUrl: flags.metroPublicBaseUrl,
    proxyBaseUrl: flags.metroProxyBaseUrl,
    bearerToken: flags.metroBearerToken,
    launchUrl: flags.launchUrl,
    companionProfileKey: resolveRemoteConfigPath({
      configPath: flags.remoteConfig,
      cwd: process.cwd(),
      env: process.env,
    }),
    companionConsumerKey: flags.session,
    port: flags.metroPreparePort,
    listenHost: flags.metroListenHost,
    statusHost: flags.metroStatusHost,
    startupTimeoutMs: flags.metroStartupTimeoutMs,
    probeTimeoutMs: flags.metroProbeTimeoutMs,
    reuseExisting: flags.metroNoReuseExisting ? false : undefined,
    installDependenciesIfNeeded: flags.metroNoInstallDeps ? false : undefined,
    runtimeFilePath: flags.metroRuntimeFile,
  });
  return platform === 'ios' ? prepared.iosRuntime : prepared.androidRuntime;
}
