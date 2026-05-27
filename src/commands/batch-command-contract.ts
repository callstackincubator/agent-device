import type { BatchRunOptions, BatchStep } from '../client-types.ts';
import { DEFAULT_BATCH_MAX_STEPS, validateAndNormalizeBatchSteps } from '../core/batch.ts';
import { defineCommand, type JsonSchema } from './command-contract.ts';
import { prepareBatchStep, type DaemonCommandName } from './command-projection.ts';
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
  type CommandFieldMap,
} from './command-input.ts';

type BatchInput = InferCommandInput<CommandFieldMap> & {
  steps: BatchStep[];
  onError?: 'stop';
  maxSteps?: number;
  out?: string;
};

export function createBatchCommand<const TCommand extends DaemonCommandName>(
  nestedCommands: readonly TCommand[],
) {
  const fields = batchFields(nestedCommands);
  return defineCommand({
    name: 'batch',
    description: 'Run multiple structured command steps in one daemon request.',
    inputSchema: fieldsInputSchema(fields),
    readInput: (input) => readBatchInput(input, fields),
    run: (client, input) => client.batch.run(toBatchOptions(input)),
  });
}

function batchFields(nestedCommands: readonly DaemonCommandName[]) {
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

function batchStepSchema(nestedCommands: readonly DaemonCommandName[]): JsonSchema {
  return {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: nestedCommands,
        description: 'Command name to run with structured input.',
      },
      input: {
        type: 'object',
        additionalProperties: true,
        description:
          'Structured command input for the nested command. Use the matching MCP tool schema for this object.',
      },
    },
    required: ['command', 'input'],
    additionalProperties: false,
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

function readBatchSteps(steps: unknown, nestedCommands: readonly DaemonCommandName[]): BatchStep[] {
  if (!Array.isArray(steps)) {
    throw new Error('Expected steps to be an array.');
  }
  return steps.map((step, index) => readBatchStep(step, index + 1, nestedCommands));
}

function readBatchStep(
  step: unknown,
  stepNumber: number,
  nestedCommands: readonly DaemonCommandName[],
): BatchStep {
  if (!step || typeof step !== 'object' || Array.isArray(step)) {
    throw new Error(`Invalid batch step ${stepNumber}.`);
  }
  const record = step as Record<string, unknown>;
  assertAllowedKeys(record, ['command', 'input'], `Batch step ${stepNumber}`);
  return prepareBatchStep(
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
