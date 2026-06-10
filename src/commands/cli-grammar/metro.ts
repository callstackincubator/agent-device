import { AppError } from '../../utils/errors.ts';
import type { MetroPrepareKind } from '../../client-metro.ts';
import type { CliReader } from './types.ts';

export const metroCliReaders = {
  metro: metroInputFromCli,
} satisfies Record<string, CliReader>;

// fallow-ignore-next-line complexity
function metroInputFromCli(positionals: string[], flags: Parameters<CliReader>[1]) {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action !== 'prepare' && action !== 'reload') {
    throw new AppError('INVALID_ARGS', 'metro requires a subcommand: prepare or reload');
  }
  if (action === 'reload') {
    return {
      action,
      metroHost: flags.metroHost,
      metroPort: flags.metroPort,
      bundleUrl: flags.bundleUrl,
      timeoutMs: flags.metroProbeTimeoutMs,
    };
  }
  if (!flags.metroPublicBaseUrl && !flags.metroProxyBaseUrl) {
    throw new AppError(
      'INVALID_ARGS',
      'metro prepare requires --public-base-url <url> or --proxy-base-url <url>.',
    );
  }
  return {
    action,
    projectRoot: flags.metroProjectRoot,
    kind: readMetroPrepareKind(flags.kind ?? flags.metroKind),
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
  };
}

function readMetroPrepareKind(value: string | undefined): MetroPrepareKind | undefined {
  if (value === undefined) return undefined;
  if (value === 'auto' || value === 'react-native' || value === 'expo') return value;
  throw new AppError('INVALID_ARGS', 'metro prepare --kind must be auto, react-native, or expo');
}
