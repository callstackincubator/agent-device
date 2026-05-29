import type { BatchRunOptions } from '../client-types.ts';
import { defineExecutableCommand } from './command-contract.ts';
import { type DaemonCommandName } from './command-projection.ts';
import { commonToClientOptions } from './command-input.ts';
import { createBatchCommandMetadata, type BatchInput } from './batch-command-metadata.ts';

export function createBatchCommand<const TCommand extends DaemonCommandName>(
  nestedCommands: readonly TCommand[],
) {
  return defineExecutableCommand(createBatchCommandMetadata(nestedCommands), (client, input) =>
    client.batch.run(toBatchOptions(input)),
  );
}

function toBatchOptions(input: BatchInput): BatchRunOptions {
  return {
    ...commonToClientOptions(input),
    steps: input.steps,
    onError: input.onError,
    maxSteps: input.maxSteps,
    out: input.out,
  };
}
