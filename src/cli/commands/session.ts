import { AppError } from '../../utils/errors.ts';
import { serializeSessionListEntry } from '../../client-shared.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import type { AgentDeviceSession } from '../../client.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const sessionCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const sub = positionals[0] ?? 'list';
  if (sub !== 'list') {
    throw new AppError('INVALID_ARGS', 'session only supports list');
  }
  const result = (await runSemanticCliCommand({
    client,
    command: 'session',
    positionals,
    flags,
  })) as { sessions: AgentDeviceSession[] };
  const sessions = result.sessions;
  const data = { sessions: sessions.map(serializeSessionListEntry) };
  writeCommandOutput(flags, data, () => JSON.stringify(data, null, 2));
  return true;
};
