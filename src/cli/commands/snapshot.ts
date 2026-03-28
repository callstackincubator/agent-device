import { formatSnapshotText, printJson } from '../../utils/output.ts';
import { serializeSnapshotResult } from '../../cli-serializers.ts';
import { buildSelectionOptions } from './shared.ts';
import type { ClientCommandHandler } from './router.ts';

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
  if (flags.json) {
    printJson({ success: true, data });
  } else {
    process.stdout.write(
      formatSnapshotText(data, {
        raw: flags.snapshotRaw,
        flatten: flags.snapshotInteractiveOnly,
      }),
    );
  }
  return true;
};
