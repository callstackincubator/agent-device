import type { CommandContext } from '../runtime-contract.ts';
import { AppError } from '../utils/errors.ts';
import type {
  BatchCommandResult,
  BatchCommandStepResult,
  CommandRouter,
  CommandRouterRequest,
} from './router-types.ts';

export type {
  BatchCommandOptions,
  BatchCommandResult,
  BatchCommandStepResult,
} from './router-types.ts';

const ROUTER_BATCH_MAX_STEPS = 50;

export async function dispatchBatchCommand<TContext>(
  request: Extract<CommandRouterRequest<TContext>, { command: 'batch' }>,
  dispatch: CommandRouter<TContext>['dispatch'],
): Promise<BatchCommandResult> {
  const steps = normalizeRouterSteps(request.options.steps, request.options.maxSteps);
  const startedAt = Date.now();
  const results: BatchCommandStepResult[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = inheritBatchContext(steps[index]!, request.options, request.context);
    const stepStartedAt = Date.now();
    const response = await dispatch(step);
    const durationMs = Date.now() - stepStartedAt;
    if (response.ok) {
      results.push({
        step: index + 1,
        command: step.command,
        ok: true,
        data: response.data,
        durationMs,
      });
      continue;
    }
    results.push({
      step: index + 1,
      command: step.command,
      ok: false,
      error: response.error,
      durationMs,
    });
    if (request.options.stopOnError !== false) break;
  }
  return {
    kind: 'batch',
    total: steps.length,
    executed: results.length,
    failed: results.filter((result) => !result.ok).length,
    totalDurationMs: Date.now() - startedAt,
    results,
  };
}

function normalizeRouterSteps<TContext>(
  steps: readonly CommandRouterRequest<TContext>[] | undefined,
  maxStepsOption: number | undefined,
): readonly CommandRouterRequest<TContext>[] {
  const maxSteps = maxStepsOption ?? ROUTER_BATCH_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > ROUTER_BATCH_MAX_STEPS) {
    throw new AppError(
      'INVALID_ARGS',
      `batch maxSteps must be an integer between 1 and ${ROUTER_BATCH_MAX_STEPS}`,
    );
  }
  if (!Array.isArray(steps) || steps.length === 0) {
    throw new AppError('INVALID_ARGS', 'batch requires a non-empty steps array');
  }
  if (steps.length > maxSteps) {
    throw new AppError(
      'INVALID_ARGS',
      `batch has ${steps.length} steps; max allowed is ${maxSteps}`,
    );
  }
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (!step || typeof step !== 'object' || typeof step.command !== 'string') {
      throw new AppError('INVALID_ARGS', `Invalid batch step at index ${index}`);
    }
    if (step.command === 'batch') {
      throw new AppError('INVALID_ARGS', `Batch step ${index + 1} cannot run ${step.command}`);
    }
  }
  return steps;
}

function inheritBatchContext<TContext>(
  step: CommandRouterRequest<TContext>,
  parentOptions: CommandContext,
  parentContext: TContext | undefined,
): CommandRouterRequest<TContext> {
  return {
    ...step,
    context: step.context ?? parentContext,
    options: {
      ...copyCommandContext(parentOptions),
      ...(step.options ?? {}),
    },
  } as CommandRouterRequest<TContext>;
}

function copyCommandContext(options: CommandContext): CommandContext {
  return {
    ...(options.session ? { session: options.session } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}
