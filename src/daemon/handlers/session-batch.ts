import {
  DEFAULT_BATCH_MAX_STEPS,
  type BatchStepResult,
  type NormalizedBatchStep,
  validateAndNormalizeBatchSteps,
} from '../../core/batch.ts';
import type { BatchStep, CommandFlags } from '../../core/dispatch.ts';
import { asAppError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';

const BATCH_PARENT_FLAG_KEYS: Array<keyof CommandFlags> = [
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'verbose',
  'out',
];

export async function runBatchCommands(
  req: DaemonRequest,
  sessionName: string,
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>,
): Promise<DaemonResponse> {
  const batchOnError = req.flags?.batchOnError ?? 'stop';
  if (batchOnError !== 'stop') {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `Unsupported batch on-error mode: ${batchOnError}.`,
      },
    };
  }
  const batchMaxSteps = req.flags?.batchMaxSteps ?? DEFAULT_BATCH_MAX_STEPS;
  if (!Number.isInteger(batchMaxSteps) || batchMaxSteps < 1 || batchMaxSteps > 1000) {
    return {
      ok: false,
      error: {
        code: 'INVALID_ARGS',
        message: `Invalid batch max-steps: ${String(req.flags?.batchMaxSteps)}`,
      },
    };
  }
  try {
    const steps = validateAndNormalizeBatchSteps(req.flags?.batchSteps, batchMaxSteps);
    const startedAt = Date.now();
    const partialResults: BatchStepResult[] = [];
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const stepResponse = await runBatchStep(req, sessionName, step, invoke, index + 1);
      if (!stepResponse.ok) {
        return {
          ok: false,
          error: {
            code: stepResponse.error.code,
            message: `Batch failed at step ${stepResponse.step} (${step.command}): ${stepResponse.error.message}`,
            hint: stepResponse.error.hint,
            diagnosticId: stepResponse.error.diagnosticId,
            logPath: stepResponse.error.logPath,
            details: {
              ...(stepResponse.error.details ?? {}),
              step: stepResponse.step,
              command: step.command,
              positionals: step.positionals,
              executed: index,
              total: steps.length,
              partialResults,
            },
          },
        };
      }
      partialResults.push(stepResponse.result);
    }
    return {
      ok: true,
      data: {
        total: steps.length,
        executed: steps.length,
        totalDurationMs: Date.now() - startedAt,
        results: partialResults,
      },
    };
  } catch (error) {
    const appErr = asAppError(error);
    return {
      ok: false,
      error: { code: appErr.code, message: appErr.message, details: appErr.details },
    };
  }
}

async function runBatchStep(
  req: DaemonRequest,
  sessionName: string,
  step: NormalizedBatchStep,
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>,
  stepNumber: number,
): Promise<
  | { ok: true; step: number; result: BatchStepResult }
  | {
      ok: false;
      step: number;
      error: {
        code: string;
        message: string;
        hint?: string;
        diagnosticId?: string;
        logPath?: string;
        details?: Record<string, unknown>;
      };
    }
> {
  const stepStartedAt = Date.now();
  const stepFlags = buildBatchStepFlags(req.flags, step.flags);
  if (stepFlags.session === undefined) {
    stepFlags.session = sessionName;
  }
  const response = await invoke({
    token: req.token,
    session: sessionName,
    command: step.command,
    positionals: step.positionals,
    flags: stepFlags,
    runtime: step.runtime as DaemonRequest['runtime'],
    meta: req.meta,
  });
  const durationMs = Date.now() - stepStartedAt;
  if (!response.ok) {
    return { ok: false, step: stepNumber, error: response.error };
  }
  return {
    ok: true,
    step: stepNumber,
    result: {
      step: stepNumber,
      command: step.command,
      ok: true,
      data: response.data ?? {},
      durationMs,
    },
  };
}

function buildBatchStepFlags(
  parentFlags: CommandFlags | undefined,
  stepFlags: BatchStep['flags'] | undefined,
): CommandFlags {
  const {
    batchSteps: _batchSteps,
    batchOnError: _batchOnError,
    batchMaxSteps: _batchMaxSteps,
    ...merged
  } = stepFlags ?? {};
  const parentRecord = (parentFlags ?? {}) as Record<string, unknown>;
  const mergedRecord = merged as Record<string, unknown>;
  for (const key of BATCH_PARENT_FLAG_KEYS) {
    if (mergedRecord[key] === undefined && parentRecord[key] !== undefined) {
      mergedRecord[key] = parentRecord[key];
    }
  }
  return merged as CommandFlags;
}
