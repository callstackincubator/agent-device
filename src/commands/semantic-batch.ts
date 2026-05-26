import type { BatchRunOptions, BatchStep } from '../client-types.ts';
import { DEFAULT_BATCH_MAX_STEPS, validateAndNormalizeBatchSteps } from '../core/batch.ts';
import { defineSemanticCommand, type JsonSchema } from './semantic-contract.ts';
import { prepareSemanticBatchStep, type SemanticDaemonCommand } from './semantic-grammar.ts';
import {
  assertAllowedKeys,
  commandInputSchema,
  commonToClientOptions,
  optionalEnum,
  optionalInteger,
  optionalString,
  readCommonInput,
  readInputRecord,
  requiredEnum,
  type CommonCommandInput,
} from './semantic-common.ts';

type BatchInput = CommonCommandInput & {
  steps: BatchStep[];
  onError?: 'stop';
  maxSteps?: number;
  out?: string;
};

export function createBatchSemanticCommand<const TCommand extends SemanticDaemonCommand>(
  nestedCommands: readonly TCommand[],
) {
  return defineSemanticCommand({
    name: 'batch',
    description: 'Run multiple structured command steps in one daemon request.',
    inputSchema: commandInputSchema(
      {
        steps: {
          type: 'array',
          description:
            'Structured batch steps. CLI JSON parsing belongs to the CLI normalizer; MCP passes this array directly.',
          items: batchStepSchema(nestedCommands),
        },
        onError: { type: 'string', enum: ['stop'], description: 'Batch failure policy.' },
        maxSteps: {
          type: 'integer',
          minimum: 1,
          maximum: 1000,
          description: 'Maximum number of steps accepted for this batch.',
        },
        out: { type: 'string', description: 'Optional output path for command artifacts.' },
      },
      ['steps'],
    ),
    outputSchema: batchResultSchema(),
    readInput: (input) => readBatchInput(input, nestedCommands),
    run: (client, input) => client.batch.run(toBatchOptions(input)),
  });
}

function batchStepSchema(nestedCommands: readonly SemanticDaemonCommand[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: nestedCommands,
        description: 'Migrated command name to run with semantic input.',
      },
      input: {
        type: 'object',
        additionalProperties: true,
        description:
          'Semantic command input for the nested command. Use the matching MCP tool schema for this object.',
      },
    },
    required: ['command', 'input'],
    additionalProperties: false,
  };
}

function batchResultSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      total: { type: 'integer' },
      executed: { type: 'integer' },
      totalDurationMs: { type: 'integer' },
      results: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
      },
    },
    additionalProperties: true,
  };
}

function readBatchInput(
  input: unknown,
  nestedCommands: readonly SemanticDaemonCommand[],
): BatchInput {
  const record = readInputRecord(input);
  const maxSteps = optionalInteger(record, 'maxSteps', { min: 1, max: 1000 });
  const normalized = validateAndNormalizeBatchSteps(
    readBatchSteps(record.steps, nestedCommands),
    maxSteps ?? DEFAULT_BATCH_MAX_STEPS,
  );
  return {
    ...readCommonInput(record),
    steps: normalized.map(({ command, positionals, flags, runtime }) => ({
      command,
      positionals,
      flags,
      runtime,
    })),
    onError: optionalEnum(record, 'onError', ['stop'] as const),
    maxSteps,
    out: optionalString(record, 'out'),
  };
}

function readBatchSteps(
  steps: unknown,
  nestedCommands: readonly SemanticDaemonCommand[],
): BatchStep[] {
  if (!Array.isArray(steps)) {
    throw new Error('Expected steps to be an array.');
  }
  return steps.map((step, index) => readBatchStep(step, index + 1, nestedCommands));
}

function readBatchStep(
  step: unknown,
  stepNumber: number,
  nestedCommands: readonly SemanticDaemonCommand[],
): BatchStep {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`Invalid batch step ${stepNumber}.`);
  }
  const record = step as Record<string, unknown>;
  assertAllowedKeys(record, ['command', 'input'], `Batch step ${stepNumber}`);
  return prepareSemanticBatchStep(
    requiredEnum(record, 'command', nestedCommands),
    record.input as Record<string, unknown>,
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
