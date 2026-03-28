import { AppError } from '../../utils/errors.ts';
import { serializeSessionListEntry } from '../../client-shared.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const sessionCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const sub = positionals[0] ?? 'list';
  if (sub !== 'list') {
    throw new AppError('INVALID_ARGS', 'session only supports list');
  }
  const sessions = await client.sessions.list();
  const data = { sessions: sessions.map(serializeSessionListEntry) };
  writeCommandOutput(flags, data, () => JSON.stringify(data, null, 2));
  return true;
};
