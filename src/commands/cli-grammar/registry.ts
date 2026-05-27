import type { BatchStep } from '../../client-types.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { AppError } from '../../utils/errors.ts';
import { isBatchCommandName, type BatchCommandName } from '../command-projection.ts';
import { appCliReaders } from './apps.ts';
import { captureCliReaders } from './capture.ts';
import { commonInputFromFlags } from './common.ts';
import { gestureCliReaders } from './gesture.ts';
import { interactionCliReaders } from './interactions.ts';
import { metroCliReaders } from './metro.ts';
import { observabilityCliReaders } from './observability.ts';
import { replayCliReaders } from './replay.ts';
import { selectorCliReaders } from './selectors.ts';
import { systemCliReaders } from './system.ts';
import type { CliReader } from './types.ts';

const cliReaders = {
  ...appCliReaders,
  ...captureCliReaders,
  ...interactionCliReaders,
  ...gestureCliReaders,
  ...selectorCliReaders,
  ...observabilityCliReaders,
  ...replayCliReaders,
  ...systemCliReaders,
  ...metroCliReaders,
  batch: (_positionals, flags) => ({
    ...commonInputFromFlags(flags),
    steps: readBatchStepsFromCli(flags.batchSteps ?? []),
    onError: flags.batchOnError,
    maxSteps: flags.batchMaxSteps,
    out: flags.out,
  }),
} satisfies Record<string, CliReader>;

export function readInputFromCli(
  command: string,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  const reader = (cliReaders as Record<string, CliReader>)[command];
  if (!reader) throw new AppError('INVALID_ARGS', `Unknown CLI command: ${command}`);
  return reader(positionals, flags);
}

function readBatchStepsFromCli(
  steps: BatchStep[],
): Array<{ command: string; input: Record<string, unknown> }> {
  return steps.map((step, index) => {
    const command = readBatchCliCommand(step.command, index + 1);
    const input = readInputFromCli(
      command,
      step.positionals ?? [],
      cliFlagsFromBatchStep(step.flags),
    );
    if (step.runtime !== undefined) input.runtime = step.runtime;
    return { command, input };
  });
}

function readBatchCliCommand(command: string, stepNumber: number): BatchCommandName {
  const normalized = command.trim().toLowerCase();
  if (isBatchCommandName(normalized)) return normalized;
  throw new AppError(
    'INVALID_ARGS',
    `Batch step ${stepNumber} command is not available through command batch: ${command}`,
  );
}

function cliFlagsFromBatchStep(flags: BatchStep['flags']): CliFlags {
  return {
    json: false,
    help: false,
    version: false,
    ...(flags as Partial<CliFlags> | undefined),
  };
}
