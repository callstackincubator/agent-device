import { serializeCloseResult, serializeOpenResult } from '../../client-shared.ts';
import { resolveRemoteOpenRuntime } from '../../core/remote-open.ts';
import { buildSelectionOptions, writeCommandMessage } from './shared.ts';
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
  const result = positionals[0]
    ? await client.apps.close({ app: positionals[0], shutdown: flags.shutdown })
    : await client.sessions.close({ shutdown: flags.shutdown });
  const data = serializeCloseResult(result);
  writeCommandMessage(flags, data);
  return true;
};
