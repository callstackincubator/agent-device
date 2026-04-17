import { formatSnapshotText } from '../../utils/output.ts';
import { serializeSnapshotResult } from '../../client-shared.ts';
import { buildSelectionOptions, writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const snapshotCommand: ClientCommandHandler = async ({ flags, client }) => {
  const result = await client.capture.snapshot({
    ...buildSelectionOptions(flags),
    interactiveOnly: flags.snapshotInteractiveOnly,
    compact: flags.snapshotCompact,
    depth: flags.snapshotDepth,
    scope: flags.snapshotScope,
    raw: flags.snapshotRaw,
  });
  const data = serializeSnapshotResult(result);
  writeCommandOutput(flags, data, () =>
    formatSnapshotText(data, {
      raw: flags.snapshotRaw,
      flatten: flags.snapshotInteractiveOnly,
    }),
  );
  return true;
};
