import type { CommandContext } from '../runtime.ts';
import { AppError, type NormalizedError } from '../utils/errors.ts';
import type { CommandRouter, CommandRouterRequest, CommandRouterResult } from './router-types.ts';

export type BatchCommandOptions<TContext = unknown> = CommandContext & {
  steps: readonly CommandRouterRequest<TContext>[];
  stopOnError?: boolean;
  maxSteps?: number;
};

export type BatchCommandStepResult =
  | {
      step: number;
      command: string;
      ok: true;
      data: CommandRouterResult;
      durationMs: number;
    }
  | {
      step: number;
      command: string;
      ok: false;
      error: NormalizedError;
      durationMs: number;
    };

export type BatchCommandResult = {
  kind: 'batch';
  total: number;
  executed: number;
  failed: number;
  totalDurationMs: number;
  results: readonly BatchCommandStepResult[];
};

export type ReplayCommandOptions<TContext = unknown> = CommandContext & {
  script?: string;
  steps?: readonly CommandRouterRequest<TContext>[];
  update?: boolean;
  maxSteps?: number;
};

export type ReplayCommandResult = {
  kind: 'replay';
  replayed: number;
  failed: number;
  healed: number;
  batch: BatchCommandResult;
};

export type ReplayTestCase<TContext = unknown> = {
  name?: string;
  script?: string;
  steps?: readonly CommandRouterRequest<TContext>[];
};

export type ReplayTestCommandOptions<TContext = unknown> = CommandContext & {
  tests: readonly ReplayTestCase<TContext>[];
  failFast?: boolean;
  retries?: number;
  maxSteps?: number;
};

export type ReplayTestCaseResult = {
  name: string;
  status: 'passed' | 'failed';
  attempts: number;
  durationMs: number;
  replay: ReplayCommandResult;
};

export type ReplayTestCommandResult = {
  kind: 'replayTest';
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  tests: readonly ReplayTestCaseResult[];
};

const ROUTER_BATCH_DEFAULT_MAX_STEPS = 50;
const ROUTER_BATCH_HARD_MAX_STEPS = 50;
const ROUTER_BATCH_BLOCKED_COMMANDS = new Set(['batch', 'replay', 'test']);

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

export async function dispatchReplayCommand<TContext>(
  request: Extract<CommandRouterRequest<TContext>, { command: 'replay' }>,
  dispatch: CommandRouter<TContext>['dispatch'],
): Promise<ReplayCommandResult> {
  if (request.options.update === true) {
    throw new AppError(
      'NOT_IMPLEMENTED',
      'router replay update/healing is not implemented yet; run replay without update',
    );
  }
  const steps = resolveReplaySteps(request.options);
  const batch = await dispatchBatchCommand(
    {
      command: 'batch',
      context: request.context,
      options: {
        ...copyCommandContext(request.options),
        steps,
        stopOnError: true,
        maxSteps: request.options.maxSteps,
      },
    },
    dispatch,
  );
  return {
    kind: 'replay',
    replayed: batch.executed,
    failed: batch.failed,
    healed: 0,
    batch,
  };
}

export async function dispatchReplayTestCommand<TContext>(
  request: Extract<CommandRouterRequest<TContext>, { command: 'test' }>,
  dispatch: CommandRouter<TContext>['dispatch'],
): Promise<ReplayTestCommandResult> {
  const tests = request.options.tests;
  if (!Array.isArray(tests) || tests.length === 0) {
    throw new AppError('INVALID_ARGS', 'test requires at least one replay test case');
  }
  const retries = normalizeRetries(request.options.retries);
  const startedAt = Date.now();
  const results: ReplayTestCaseResult[] = [];

  for (let index = 0; index < tests.length; index += 1) {
    const testCase = tests[index]!;
    const caseStartedAt = Date.now();
    const name = normalizeTestName(testCase.name, index);
    let replay: ReplayCommandResult | undefined;
    let attempts = 0;
    for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
      attempts = attemptIndex + 1;
      replay = await dispatchReplayCommand(
        {
          command: 'replay',
          context: request.context,
          options: {
            ...copyCommandContext(request.options),
            script: testCase.script,
            steps: testCase.steps,
            maxSteps: request.options.maxSteps,
          },
        },
        dispatch,
      );
      if (replay.failed === 0) break;
    }
    const status = replay?.failed === 0 ? 'passed' : 'failed';
    results.push({
      name,
      status,
      attempts,
      durationMs: Date.now() - caseStartedAt,
      replay: replay!,
    });
    if (status === 'failed' && request.options.failFast === true) break;
  }

  const failed = results.filter((result) => result.status === 'failed').length;
  return {
    kind: 'replayTest',
    total: tests.length,
    passed: results.length - failed,
    failed,
    durationMs: Date.now() - startedAt,
    tests: results,
  };
}

function normalizeRouterSteps<TContext>(
  steps: readonly CommandRouterRequest<TContext>[] | undefined,
  maxStepsOption: number | undefined,
): readonly CommandRouterRequest<TContext>[] {
  const maxSteps = maxStepsOption ?? ROUTER_BATCH_DEFAULT_MAX_STEPS;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > ROUTER_BATCH_HARD_MAX_STEPS) {
    throw new AppError(
      'INVALID_ARGS',
      `batch maxSteps must be an integer between 1 and ${ROUTER_BATCH_HARD_MAX_STEPS}`,
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
    if (ROUTER_BATCH_BLOCKED_COMMANDS.has(step.command)) {
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

function resolveReplaySteps<TContext>(
  options: ReplayCommandOptions<TContext>,
): readonly CommandRouterRequest<TContext>[] {
  if (options.steps !== undefined) return normalizeRouterSteps(options.steps, options.maxSteps);
  if (typeof options.script === 'string') {
    return normalizeRouterSteps(parseRouterReplayScript(options.script), options.maxSteps);
  }
  throw new AppError('INVALID_ARGS', 'replay requires script or steps');
}

function parseRouterReplayScript<TContext>(script: string): CommandRouterRequest<TContext>[] {
  const steps: CommandRouterRequest<TContext>[] = [];
  for (const line of script.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('context ')) continue;
    const separator = trimmed.search(/\s/);
    const command = separator === -1 ? trimmed : trimmed.slice(0, separator);
    const rawOptions = separator === -1 ? '{}' : trimmed.slice(separator).trim();
    let options: unknown;
    try {
      options = rawOptions ? JSON.parse(rawOptions) : {};
    } catch {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid replay script options for ${command}; expected JSON object`,
      );
    }
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new AppError('INVALID_ARGS', `Replay script options for ${command} must be an object`);
    }
    steps.push({ command, options } as CommandRouterRequest<TContext>);
  }
  return steps;
}

function normalizeRetries(retries: number | undefined): number {
  if (retries === undefined) return 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 3) {
    throw new AppError('INVALID_ARGS', 'test retries must be an integer between 0 and 3');
  }
  return retries;
}

function normalizeTestName(name: string | undefined, index: number): string {
  const normalized = name?.trim();
  return normalized || `test-${index + 1}`;
}

function copyCommandContext(options: CommandContext): CommandContext {
  return {
    ...(options.session ? { session: options.session } : {}),
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.metadata ? { metadata: options.metadata } : {}),
  };
}
