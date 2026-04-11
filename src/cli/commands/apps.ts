import { buildSelectionOptions, writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

export const appsCommand: ClientCommandHandler = async ({ flags, client }) => {
  const apps = await client.apps.list({
    ...buildSelectionOptions(flags),
    appsFilter: flags.appsFilter,
  });
  const data = { apps };
  writeCommandOutput(flags, data, () => apps.join('\n'));
  return true;
};
