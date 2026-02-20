import { AppError } from '../utils/errors.ts';
import type { BatchStep, CommandFlags } from './dispatch.ts';

export const DEFAULT_BATCH_MAX_STEPS = 100;
const BATCH_BLOCKED_COMMANDS = new Set(['batch', 'replay']);

export type NormalizedBatchStep = {
  command: string;
  positionals: string[];
  flags: Partial<CommandFlags>;
};

export type BatchStepResult = {
  step: number;
  command: string;
  ok: true;
  data: Record<string, unknown>;
  durationMs: number;
};

export function parseBatchStepsJson(raw: string): BatchStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AppError('INVALID_ARGS', 'Batch steps must be valid JSON.');
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new AppError('INVALID_ARGS', 'Batch steps must be a non-empty JSON array.');
  }
  return parsed as BatchStep[];
}

export function validateAndNormalizeBatchSteps(
  steps: CommandFlags['batchSteps'],
  maxSteps: number,
): NormalizedBatchStep[] {
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AppError('INVALID_ARGS', 'batch requires a non-empty batchSteps array.');
  }
  if (steps.length > maxSteps) {
    throw new AppError('INVALID_ARGS', `batch has ${steps.length} steps; max allowed is ${maxSteps}.`);
  }

  const normalized: NormalizedBatchStep[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || typeof step !== 'object') {
      throw new AppError('INVALID_ARGS', `Invalid batch step at index ${index}.`);
    }
    const command = typeof step.command === 'string' ? step.command.trim().toLowerCase() : '';
    if (!command) {
      throw new AppError('INVALID_ARGS', `Batch step ${index + 1} requires command.`);
    }
    if (BATCH_BLOCKED_COMMANDS.has(command)) {
      throw new AppError('INVALID_ARGS', `Batch step ${index + 1} cannot run ${command}.`);
    }
    if (step.positionals !== undefined && !Array.isArray(step.positionals)) {
      throw new AppError('INVALID_ARGS', `Batch step ${index + 1} positionals must be an array.`);
    }
    const positionals = (step.positionals ?? []) as unknown[];
    if (positionals.some((value) => typeof value !== 'string')) {
      throw new AppError('INVALID_ARGS', `Batch step ${index + 1} positionals must contain only strings.`);
    }
    if (step.flags !== undefined && (typeof step.flags !== 'object' || Array.isArray(step.flags) || !step.flags)) {
      throw new AppError('INVALID_ARGS', `Batch step ${index + 1} flags must be an object.`);
    }
    normalized.push({
      command,
      positionals: positionals as string[],
      flags: (step.flags ?? {}) as Partial<CommandFlags>,
    });
  }
  return normalized;
}
