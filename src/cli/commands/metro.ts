import { AppError } from '../../utils/errors.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const metroCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action === 'reload') {
    const result = await client.metro.reload({
      metroHost: flags.metroHost,
      metroPort: flags.metroPort,
      bundleUrl: flags.bundleUrl,
      timeoutMs: flags.metroProbeTimeoutMs,
    });
    writeCommandOutput(flags, result, () => `Reloaded React Native apps via ${result.reloadUrl}`);
    return true;
  }
  if (action !== 'prepare') {
    throw new AppError('INVALID_ARGS', 'metro requires a subcommand: prepare or reload');
  }
  if (!flags.metroPublicBaseUrl && !flags.metroProxyBaseUrl) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare requires --public-base-url <url> or --proxy-base-url <url>.',
    );
  }

  const result = await client.metro.prepare({
    projectRoot: flags.metroProjectRoot,
    kind: flags.metroKind,
    port: flags.metroPreparePort,
    listenHost: flags.metroListenHost,
    statusHost: flags.metroStatusHost,
    publicBaseUrl: flags.metroPublicBaseUrl,
    proxyBaseUrl: flags.metroProxyBaseUrl,
    bearerToken: flags.metroBearerToken,
    bridgeScope:
      flags.tenant && flags.runId && flags.leaseId
        ? {
            tenantId: flags.tenant,
            runId: flags.runId,
            leaseId: flags.leaseId,
          }
        : undefined,
    startupTimeoutMs: flags.metroStartupTimeoutMs,
    probeTimeoutMs: flags.metroProbeTimeoutMs,
    reuseExisting: flags.metroNoReuseExisting ? false : undefined,
    installDependenciesIfNeeded: flags.metroNoInstallDeps ? false : undefined,
    runtimeFilePath: flags.metroRuntimeFile,
  });

  writeCommandOutput(flags, result, () => JSON.stringify(result, null, 2));
  return true;
};
