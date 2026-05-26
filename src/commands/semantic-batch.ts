import type { BatchRunOptions, BatchStep } from '../client-types.ts';
import { DEFAULT_BATCH_MAX_STEPS, validateAndNormalizeBatchSteps } from '../core/batch.ts';
import { defineSemanticCommand, type JsonSchema } from './semantic-contract.ts';
import { prepareSemanticBatchStep, type SemanticDaemonCommand } from './semantic-grammar.ts';
import {
  assertAllowedKeys,
  commonToClientOptions,
  customField,
  enumField,
  fieldsInputSchema,
  integerField,
  readFieldInput,
  requiredEnum,
  requiredField,
  stringField,
  type InferCommandInput,
  type SemanticFieldMap,
} from './semantic-common.ts';

type BatchInput = InferCommandInput<SemanticFieldMap> & {
  steps: BatchStep[];
  onError?: 'stop';
  maxSteps?: number;
  out?: string;
};

export function createBatchSemanticCommand<const TCommand extends SemanticDaemonCommand>(
  nestedCommands: readonly TCommand[],
) {
  const fields = batchFields(nestedCommands);
  return defineSemanticCommand({
    name: 'batch',
    description: 'Run multiple structured command steps in one daemon request.',
    inputSchema: fieldsInputSchema(fields),
    outputSchema: batchResultSchema(),
    readInput: (input) => readBatchInput(input, fields),
    run: (client, input) => client.batch.run(toBatchOptions(input)),
  });
}

function batchFields(nestedCommands: readonly SemanticDaemonCommand[]) {
  return {
    steps: requiredField(
      customField<BatchStep[]>(
        {
          type: 'array',
          description:
            'Structured batch steps. CLI JSON parsing belongs to the CLI normalizer; MCP passes this array directly.',
          items: batchStepSchema(nestedCommands),
        },
        (record, key) => readBatchSteps(record[key], nestedCommands),
      ),
    ),
    onError: enumField(['stop'] as const, 'Batch failure policy.'),
    maxSteps: integerField('Maximum number of steps accepted for this batch.', {
      min: 1,
      max: 1000,
    }),
    out: stringField('Optional output path for command artifacts.'),
  };
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

function readBatchInput(input: unknown, fields: ReturnType<typeof batchFields>): BatchInput {
  const parsed = readFieldInput(input, fields);
  const normalized = validateAndNormalizeBatchSteps(
    parsed.steps,
    parsed.maxSteps ?? DEFAULT_BATCH_MAX_STEPS,
  );
  return {
    ...parsed,
    steps: normalized.map(({ command, positionals, flags, runtime }) => ({
      command,
      positionals,
      flags,
      runtime,
    })),
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
