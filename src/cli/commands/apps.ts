import { buildSelectionOptions, writeCommandOutput } from './shared.ts';
import { assertResolvedAppsFilter } from '../../commands/app-inventory-contract.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const appsCommand: ClientCommandHandler = async ({ flags, client }) => {
  const appsFilter = assertResolvedAppsFilter(flags.appsFilter);
  const apps = await client.apps.list({
    ...buildSelectionOptions(flags),
    appsFilter,
  });
  const data = { apps };
  writeCommandOutput(flags, data, () => {
    if (!flags.json) {
      process.stderr.write(
        appsFilter === 'all'
          ? 'Showing all apps, including system apps.\n'
          : 'Showing user-installed apps. Use --all to include system apps.\n',
      );
    }
    if (apps.length > 0) return apps.join('\n');
    return appsFilter === 'all' ? 'No apps found.' : 'No user-installed apps found.';
  });
  return true;
};
