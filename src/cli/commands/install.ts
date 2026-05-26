import { serializeDeployResult, serializeInstallFromSourceResult } from '../../client-shared.ts';
import type { AppDeployResult, AppInstallFromSourceResult } from '../../client.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import { writeCommandMessage } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const installCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = (await runSemanticCliCommand({
    client,
    command: 'install',
    positionals,
    flags,
  })) as AppDeployResult;
  const data = serializeDeployResult(result);
  writeCommandMessage(flags, data);
  return true;
};

export const reinstallCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const result = (await runSemanticCliCommand({
    client,
    command: 'reinstall',
    positionals,
    flags,
  })) as AppDeployResult;
  const data = serializeDeployResult(result);
  writeCommandMessage(flags, data);
  return true;
};

export const installFromSourceCommand: ClientCommandHandler = async ({
  positionals,
  flags,
  client,
}) => {
  const result = (await runSemanticCliCommand({
    client,
    command: 'install-from-source',
    positionals,
    flags,
  })) as AppInstallFromSourceResult;
  const data = serializeInstallFromSourceResult(result);
  writeCommandMessage(flags, data);
  return true;
};
