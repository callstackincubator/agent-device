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
    forceFull: flags.snapshotForceFull,
  });
  const data = serializeSnapshotResult(result);
  // Programmatic SDK callers can see `unchanged`; CLI --json hides it for schema compatibility.
  const outputData = flags.json ? withoutUnchanged(data) : data;
  writeCommandOutput(flags, outputData, () =>
    formatSnapshotText(outputData, {
      raw: flags.snapshotRaw,
      flatten: flags.snapshotInteractiveOnly,
    }),
  );
  return true;
};

function withoutUnchanged(data: Record<string, unknown>): Record<string, unknown> {
  const { unchanged: _unchanged, ...outputData } = data;
  return outputData;
}
