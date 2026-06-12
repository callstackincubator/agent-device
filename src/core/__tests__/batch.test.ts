import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validateAndNormalizeBatchSteps, type DaemonBatchStep } from '../batch.ts';

test('validateAndNormalizeBatchSteps rejects unknown top-level step fields', () => {
  assert.throws(
    () =>
      validateAndNormalizeBatchSteps(
        [
          {
            command: 'open',
            positionals: ['Settings'],
            args: ['unexpected'],
          } as unknown as DaemonBatchStep,
        ],
        10,
      ),
    /unknown field\(s\): "args"/i,
  );
});

test('validateAndNormalizeBatchSteps blocks replay daemon steps', () => {
  assert.throws(
    () => validateAndNormalizeBatchSteps([{ command: 'replay' }], 10),
    /cannot run replay/i,
  );
});
