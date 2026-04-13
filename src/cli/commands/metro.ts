import { AppError } from '../../utils/errors.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const metroCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action !== 'prepare') {
    throw new AppError('INVALID_ARGS', 'metro only supports prepare');
  }
  if (!flags.metroPublicBaseUrl) {
    throw new AppError('INVALID_ARGS', 'metro prepare requires --public-base-url <url>.');
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
