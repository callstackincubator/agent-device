import { serializeCloseResult, serializeOpenResult } from '../../client-shared.ts';
import { stopMetroTunnel } from '../../metro.ts';
import { resolveRemoteOpenRuntime } from '../../core/remote-open.ts';
import { resolveRemoteConfigProfile } from '../../remote-config.ts';
import { buildSelectionOptions, writeCommandMessage } from './shared.ts';
import type { StopMetroTunnelOptions } from '../../metro.ts';
import type { ClientCommandHandler } from './router.ts';

export const openCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const runtime = await resolveRemoteOpenRuntime(flags, client);
  const result = await client.apps.open({
    app: positionals[0],
    url: positionals[1],
    surface: flags.surface,
    activity: flags.activity,
    relaunch: flags.relaunch,
    saveScript: flags.saveScript,
    noRecord: flags.noRecord,
    runtime,
    ...buildSelectionOptions(flags),
  });
  const data = serializeOpenResult(result);
  writeCommandMessage(flags, data);
  return true;
};

export const closeCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const resolveManagedMetroCompanionStopOptions = (): StopMetroTunnelOptions | null => {
    if (!flags.remoteConfig) return null;
    let remoteConfig;
    try {
      remoteConfig = resolveRemoteConfigProfile({
        configPath: flags.remoteConfig,
        cwd: process.cwd(),
        env: process.env,
      });
    } catch {
      return null;
    }
    if (!remoteConfig.profile.metroProjectRoot || !remoteConfig.profile.metroProxyBaseUrl) {
      return null;
    }
    return {
      projectRoot: remoteConfig.profile.metroProjectRoot,
      profileKey: remoteConfig.resolvedPath,
      consumerKey: flags.session,
    };
  };

  const managedMetroCompanionStopOptions = resolveManagedMetroCompanionStopOptions();

  const runWithCompanionCleanup = async <T>(runClose: () => Promise<T>): Promise<T> => {
    try {
      return await runClose();
    } finally {
      try {
        if (managedMetroCompanionStopOptions) {
          await stopMetroTunnel(managedMetroCompanionStopOptions);
        }
      } catch {
        // Companion cleanup is best-effort and must not turn a successful close into a failure.
      }
    }
  };

  const result = await runWithCompanionCleanup(async () => {
    if (positionals[0]) {
      return await client.apps.close({ app: positionals[0], shutdown: flags.shutdown });
    }
    return await client.sessions.close({ shutdown: flags.shutdown });
  });

  const data = serializeCloseResult(result);
  writeCommandMessage(flags, data);
  return true;
};
