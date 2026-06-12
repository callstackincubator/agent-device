import { PUBLIC_COMMANDS } from '../../command-catalog.ts';
import {
  STRUCTURED_BATCH_COMMAND_NAMES,
  readStructuredBatchCommandName,
} from '../../batch-policy.ts';
import { buildFlags } from '../../client-normalizers.ts';
import type { DaemonBatchStep } from '../../core/batch.ts';
import { AppError } from '../../utils/errors.ts';
import { request } from '../cli-grammar/common.ts';
import type { CommandInput, DaemonCommandRequest, DaemonWriter } from '../cli-grammar/types.ts';
import type { DaemonCommandName } from '../command-projection.ts';

const batchCommandNames = STRUCTURED_BATCH_COMMAND_NAMES satisfies readonly DaemonCommandName[];

export type BatchCommandName = (typeof batchCommandNames)[number];

type PrepareDaemonCommandRequest = (command: string, input: CommandInput) => DaemonCommandRequest;

export function createBatchDaemonWriter(
  prepareDaemonCommandRequest: PrepareDaemonCommandRequest,
): DaemonWriter {
  return (input) =>
    request(PUBLIC_COMMANDS.batch, [], {
      ...input,
      batchSteps: readBatchDaemonSteps(input.steps, prepareDaemonCommandRequest),
      batchOnError: input.onError,
      batchMaxSteps: input.maxSteps,
    });
}

function readBatchDaemonSteps(
  steps: unknown,
  prepareDaemonCommandRequest: PrepareDaemonCommandRequest,
): DaemonBatchStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AppError('INVALID_ARGS', 'batch requires a non-empty steps array.');
  }
  return steps.map((step, index) =>
    readBatchDaemonStep(step, index + 1, prepareDaemonCommandRequest),
  );
}

function readBatchDaemonStep(
  step: unknown,
  stepNumber: number,
  prepareDaemonCommandRequest: PrepareDaemonCommandRequest,
): DaemonBatchStep {
  const record = readBatchStepRecord(step, stepNumber);
  const command = readBatchStepCommand(record, stepNumber);
  const input = readBatchStepInput(record, stepNumber);
  const runtime = readBatchStepRuntime(record, stepNumber);
  const prepared = prepareBatchStep(command, input, prepareDaemonCommandRequest);
  return {
    ...prepared,
    runtime: runtime ?? prepared.runtime,
  };
}

function prepareBatchStep(
  command: BatchCommandName,
  input: CommandInput,
  prepareDaemonCommandRequest: PrepareDaemonCommandRequest,
): DaemonBatchStep {
  const prepared = prepareDaemonCommandRequest(command, input);
  return {
    command: prepared.command,
    positionals: prepared.positionals,
    flags: buildFlags(prepared.options),
    runtime: prepared.options.runtime,
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
  return readStructuredBatchCommandName(record.command, stepNumber);
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
