import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import { buildFlags } from '../../client-normalizers.ts';
import type { BatchStep } from '../../client-types.ts';
import type { CliFlags } from '../../utils/command-schema.ts';
import { AppError } from '../../utils/errors.ts';
import { appCliReaders, appDaemonWriters } from './apps.ts';
import { captureCliReaders, captureDaemonWriters } from './capture.ts';
import { commandNameSet, commonInputFromFlags, request } from './common.ts';
import { gestureCliReaders, gestureDaemonWriters } from './gesture.ts';
import { interactionCliReaders, interactionDaemonWriters } from './interactions.ts';
import { metroCliReaders } from './metro.ts';
import { observabilityCliReaders, observabilityDaemonWriters } from './observability.ts';
import { replayCliReaders, replayDaemonWriters } from './replay.ts';
import { selectorCliReaders, selectorDaemonWriters } from './selectors.ts';
import { systemCliReaders, systemDaemonWriters } from './system.ts';
import type { CliReader, DaemonWriter, DaemonCommandRequest, CommandInput } from './types.ts';

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

const daemonWriters = {
  ...appDaemonWriters,
  ...captureDaemonWriters,
  ...interactionDaemonWriters,
  ...gestureDaemonWriters,
  ...selectorDaemonWriters,
  ...observabilityDaemonWriters,
  ...replayDaemonWriters,
  ...systemDaemonWriters,
  batch: (input) =>
    request(PUBLIC_COMMANDS.batch, [], {
      ...input,
      batchSteps: input.steps,
      batchOnError: input.onError,
      batchMaxSteps: input.maxSteps,
    }),
} satisfies Record<string, DaemonWriter>;

export type DaemonCommandName = keyof typeof daemonWriters;
type NonBatchCommandName =
  | 'replay'
  | 'batch'
  | 'gesture-pan'
  | 'gesture-fling'
  | 'gesture-pinch'
  | 'gesture-rotate'
  | 'gesture-transform';
export type BatchCommandName = Exclude<DaemonCommandName, NonBatchCommandName>;

const nonBatchCommandNames = commandNameSet([
  'replay',
  'batch',
  'gesture-pan',
  'gesture-fling',
  'gesture-pinch',
  'gesture-rotate',
  'gesture-transform',
] as const satisfies readonly NonBatchCommandName[]);

export const batchCommandNames = (Object.keys(daemonWriters) as DaemonCommandName[]).filter(
  (name): name is BatchCommandName => !nonBatchCommandNames.has(name),
);

const batchNames = commandNameSet(batchCommandNames);

export function readInputFromCli(
  command: string,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  const reader = (cliReaders as Record<string, CliReader>)[command];
  if (!reader) throw new AppError('INVALID_ARGS', `Unknown CLI command: ${command}`);
  return reader(positionals, flags);
}

export function prepareBatchStep(command: DaemonCommandName, input: CommandInput): BatchStep {
  const prepared = prepareDaemonCommandRequest(command, input);
  return {
    command: prepared.command,
    positionals: prepared.positionals,
    flags: buildFlags(prepared.options),
    runtime: prepared.options.runtime,
  };
}

export function prepareDaemonCommandRequest(
  command: DaemonCommandName,
  input: CommandInput,
): DaemonCommandRequest {
  return daemonWriters[command](input);
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

function isBatchCommandName(name: string): name is BatchCommandName {
  return batchNames.has(name);
}

function cliFlagsFromBatchStep(flags: BatchStep['flags']): CliFlags {
  return {
    json: false,
    help: false,
    version: false,
    ...(flags as Partial<CliFlags> | undefined),
  };
}
