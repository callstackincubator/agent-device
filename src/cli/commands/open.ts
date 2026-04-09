import { serializeCloseResult, serializeOpenResult } from '../../client-shared.ts';
import { stopMetroCompanion } from '../../client-metro-companion.ts';
import { resolveRemoteOpenRuntime } from '../../core/remote-open.ts';
import { loadRemoteConfigFile } from '../../utils/remote-config.ts';
import { buildSelectionOptions, writeCommandMessage } from './shared.ts';
import type { AgentDeviceClient } from '../../client.ts';
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
  const stopManagedMetroCompanion = async (): Promise<void> => {
    if (!flags.remoteConfig) return;
    const remoteConfig = loadRemoteConfigFile({
      configPath: flags.remoteConfig,
      cwd: process.cwd(),
      env: process.env,
    });
    if (remoteConfig.metroProjectRoot && remoteConfig.metroProxyBaseUrl) {
      await stopMetroCompanion({ projectRoot: remoteConfig.metroProjectRoot });
    }
  };

  let result:
    | Awaited<ReturnType<AgentDeviceClient['apps']['close']>>
    | Awaited<ReturnType<AgentDeviceClient['sessions']['close']>>;
  let closeError: unknown;

  try {
    result = positionals[0]
      ? await client.apps.close({ app: positionals[0], shutdown: flags.shutdown })
      : await client.sessions.close({ shutdown: flags.shutdown });
  } catch (error) {
    closeError = error;
  } finally {
    try {
      await stopManagedMetroCompanion();
    } catch (cleanupError) {
      if (!closeError) {
        throw cleanupError;
      }
    }
  }

  if (closeError) {
    throw closeError;
  }

  const data = serializeCloseResult(result!);
  writeCommandMessage(flags, data);
  return true;
};
