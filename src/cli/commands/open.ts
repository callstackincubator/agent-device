import { serializeCloseResult, serializeOpenResult } from '../../client-shared.ts';
import { stopMetroCompanion } from '../../client-metro-companion.ts';
import { resolveRemoteOpenRuntime } from '../../core/remote-open.ts';
import { loadRemoteConfigFile, resolveRemoteConfigPath } from '../../utils/remote-config.ts';
import { buildSelectionOptions, writeCommandMessage } from './shared.ts';
import type { StopMetroCompanionOptions } from '../../client-metro-companion.ts';
import type { ClientCommandHandler } from './router.ts';

export const openCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  if (!positionals[0]) {
    return false;
  }
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
  const resolveManagedMetroCompanionStopOptions = (): StopMetroCompanionOptions | null => {
    if (!flags.remoteConfig) return null;
    const profileKey = resolveRemoteConfigPath({
      configPath: flags.remoteConfig,
      cwd: process.cwd(),
      env: process.env,
    });
    let remoteConfig;
    try {
      remoteConfig = loadRemoteConfigFile({
        configPath: flags.remoteConfig,
        cwd: process.cwd(),
        env: process.env,
      });
    } catch {
      return null;
    }
    if (!remoteConfig.metroProjectRoot || !remoteConfig.metroProxyBaseUrl) {
      return null;
    }
    return {
      projectRoot: remoteConfig.metroProjectRoot,
      profileKey,
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
          await stopMetroCompanion(managedMetroCompanionStopOptions);
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
