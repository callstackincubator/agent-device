import { formatSnapshotText } from '../../utils/output.ts';
import { serializeSnapshotResult } from '../../client-shared.ts';
import { runSemanticCliCommand } from '../../commands/semantic-cli.ts';
import type { CaptureSnapshotResult } from '../../client.ts';
import { writeCommandOutput } from './shared.ts';
import type { ClientCommandHandler } from './router-types.ts';

export const snapshotCommand: ClientCommandHandler = async ({ flags, client }) => {
  const result = (await runSemanticCliCommand({
    client,
    command: 'snapshot',
    positionals: [],
    flags,
  })) as CaptureSnapshotResult;
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
