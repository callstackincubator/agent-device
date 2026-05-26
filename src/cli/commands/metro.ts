import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const metroCommand: ClientCommandHandler = async ({ positionals, flags, client }) => {
  const action = (positionals[0] ?? '').toLowerCase();
  if (action === 'reload') {
    const result = await runSemanticCliCommand({ client, command: 'metro', positionals, flags });
    writeCommandOutput(flags, result, () => `Reloaded React Native apps via ${result.reloadUrl}`);
    return true;
  }
  const result = await runSemanticCliCommand({ client, command: 'metro', positionals, flags });

  writeCommandOutput(flags, result, () => JSON.stringify(result, null, 2));
  return true;
};
