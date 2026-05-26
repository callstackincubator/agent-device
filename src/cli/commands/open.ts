import { serializeCloseResult, serializeOpenResult } from '../../client-shared.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import type { AppCloseResult, AppOpenResult, SessionCloseResult } from '../../client.ts';
import { writeCommandMessage } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const openCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = (await runSemanticCliCommand({
    client,
    command: 'open',
    positionals,
    flags,
  })) as AppOpenResult;
  const data = serializeOpenResult(result);
  writeCommandMessage(flags, data);
  return true;
};

export const closeCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = (await runSemanticCliCommand({
    client,
    command: 'close',
    positionals,
    flags,
  })) as AppCloseResult | SessionCloseResult;
  const data = serializeCloseResult(result);
  writeCommandMessage(flags, data);
  return true;
};
