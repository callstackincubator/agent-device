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
import type {
  CliReader,
  DaemonWriter,
  SemanticDaemonRequest,
  SemanticRequestInput,
} from './types.ts';

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
    steps: readSemanticBatchStepsFromCli(flags.batchSteps ?? []),
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

export type SemanticDaemonCommand = keyof typeof daemonWriters;
type NonBatchSemanticCommand =
  | 'replay'
  | 'batch'
  | 'gesture-pan'
  | 'gesture-fling'
  | 'gesture-pinch'
  | 'gesture-rotate'
  | 'gesture-transform';
export type SemanticBatchCommand = Exclude<SemanticDaemonCommand, NonBatchSemanticCommand>;

const semanticNonBatchCommandNames = commandNameSet([
  'replay',
  'batch',
  'gesture-pan',
  'gesture-fling',
  'gesture-pinch',
  'gesture-rotate',
  'gesture-transform',
] as const satisfies readonly NonBatchSemanticCommand[]);

export const semanticBatchCommandNames = (
  Object.keys(daemonWriters) as SemanticDaemonCommand[]
).filter((name): name is SemanticBatchCommand => !semanticNonBatchCommandNames.has(name));

const semanticBatchNames = commandNameSet(semanticBatchCommandNames);

export function readSemanticInputFromCli(
  command: string,
  positionals: string[],
  flags: CliFlags,
): Record<string, unknown> {
  const reader = (cliReaders as Record<string, CliReader>)[command];
  if (!reader) throw new AppError('INVALID_ARGS', `Unknown semantic CLI command: ${command}`);
  return reader(positionals, flags);
}

export function prepareSemanticBatchStep(
  command: SemanticDaemonCommand,
  input: SemanticRequestInput,
): BatchStep {
  const prepared = prepareSemanticDaemonRequest(command, input);
  return {
    command: prepared.command,
    positionals: prepared.positionals,
    flags: buildFlags(prepared.options),
    runtime: prepared.options.runtime,
  };
}

export function prepareSemanticDaemonRequest(
  command: SemanticDaemonCommand,
  input: SemanticRequestInput,
): SemanticDaemonRequest {
  return daemonWriters[command](input);
}

function readSemanticBatchStepsFromCli(
  steps: BatchStep[],
): Array<{ command: string; input: Record<string, unknown> }> {
  return steps.map((step, index) => {
    const command = readBatchCliCommand(step.command, index + 1);
    const input = readSemanticInputFromCli(
      command,
      step.positionals ?? [],
      cliFlagsFromBatchStep(step.flags),
    );
    if (step.runtime !== undefined) input.runtime = step.runtime;
    return { command, input };
  });
}

function readBatchCliCommand(command: string, stepNumber: number): SemanticBatchCommand {
  const normalized = command.trim().toLowerCase();
  if (isSemanticBatchCommand(normalized)) return normalized;
  throw new AppError(
    'INVALID_ARGS',
    `Batch step ${stepNumber} command is not available through semantic batch: ${command}`,
  );
}

function isSemanticBatchCommand(name: string): name is SemanticBatchCommand {
  return semanticBatchNames.has(name);
}

function cliFlagsFromBatchStep(flags: BatchStep['flags']): CliFlags {
  return {
    json: false,
    help: false,
    version: false,
    ...(flags as Partial<CliFlags> | undefined),
  };
}
