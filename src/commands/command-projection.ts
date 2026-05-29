import { BATCH_COMMAND_NAMES, PUBLIC_COMMANDS } from '../command-catalog.ts';
import { buildFlags } from '../client-normalizers.ts';
import type { DaemonBatchStep } from '../core/batch.ts';
import { AppError } from '../utils/errors.ts';
import { appDaemonWriters } from './cli-grammar/apps.ts';
import { captureDaemonWriters } from './cli-grammar/capture.ts';
import { commandNameSet, request } from './cli-grammar/common.ts';
import { gestureDaemonWriters } from './cli-grammar/gesture.ts';
import { interactionDaemonWriters } from './cli-grammar/interactions.ts';
import { observabilityDaemonWriters } from './cli-grammar/observability.ts';
import { replayDaemonWriters } from './cli-grammar/replay.ts';
import { selectorDaemonWriters } from './cli-grammar/selectors.ts';
import { systemDaemonWriters } from './cli-grammar/system.ts';
import type { CommandInput, DaemonCommandRequest, DaemonWriter } from './cli-grammar/types.ts';

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
      batchSteps: readBatchDaemonSteps(input.steps),
      batchOnError: input.onError,
      batchMaxSteps: input.maxSteps,
    }),
} satisfies Record<string, DaemonWriter>;

export type DaemonCommandName = keyof typeof daemonWriters;

export type BatchCommandName = (typeof BATCH_COMMAND_NAMES)[number];

export const batchCommandNames = BATCH_COMMAND_NAMES satisfies readonly DaemonCommandName[];

const batchNames = commandNameSet(batchCommandNames);

function isBatchCommandName(name: string): name is BatchCommandName {
  return batchNames.has(name);
}

function prepareBatchStep(command: DaemonCommandName, input: CommandInput): DaemonBatchStep {
  const prepared = prepareDaemonCommandRequest(command, input);
  return {
    command: prepared.command,
    positionals: prepared.positionals,
    flags: buildFlags(prepared.options),
    runtime: prepared.options.runtime,
  };
}

function readBatchDaemonSteps(steps: unknown): DaemonBatchStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AppError('INVALID_ARGS', 'batch requires a non-empty steps array.');
  }
  return steps.map((step, index) => readBatchDaemonStep(step, index + 1));
}

function readBatchDaemonStep(step: unknown, stepNumber: number): DaemonBatchStep {
  const record = readBatchStepRecord(step, stepNumber);
  const command = readBatchStepCommand(record, stepNumber);
  const input = readBatchStepInput(record, stepNumber);
  const runtime = readBatchStepRuntime(record, stepNumber);
  const prepared = prepareBatchStep(command, input);
  return {
    ...prepared,
    runtime: runtime ?? prepared.runtime,
  };
}

function readBatchStepRecord(step: unknown, stepNumber: number): Record<string, unknown> {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new AppError('INVALID_ARGS', `Invalid batch step ${stepNumber}.`);
  }
  return step as Record<string, unknown>;
}

function readBatchStepCommand(
  record: Record<string, unknown>,
  stepNumber: number,
): BatchCommandName {
  const command = typeof record.command === 'string' ? record.command.trim().toLowerCase() : '';
  if (isBatchCommandName(command)) return command;
  throw new AppError(
    'INVALID_ARGS',
    `Batch step ${stepNumber} command is not available through command batch: ${String(record.command)}`,
  );
}

function readBatchStepInput(record: Record<string, unknown>, stepNumber: number): CommandInput {
  const input = record.input;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('INVALID_ARGS', `Batch step ${stepNumber} input must be an object.`);
  }
  return input as CommandInput;
}

function readBatchStepRuntime(
  record: Record<string, unknown>,
  stepNumber: number,
): Record<string, unknown> | undefined {
  const runtime = record.runtime;
  if (
    runtime !== undefined &&
    (!runtime || typeof runtime !== 'object' || Array.isArray(runtime))
  ) {
    throw new AppError('INVALID_ARGS', `Batch step ${stepNumber} runtime must be an object.`);
  }
  return runtime as Record<string, unknown> | undefined;
}

export function prepareDaemonCommandRequest(
  command: DaemonCommandName,
  input: CommandInput,
): DaemonCommandRequest {
  return daemonWriters[command](input);
}
