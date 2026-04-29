import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validateAndNormalizeBatchSteps, type BatchStep } from '../batch.ts';

test('validateAndNormalizeBatchSteps rejects unknown top-level step fields', () => {
  assert.throws(
    () =>
      validateAndNormalizeBatchSteps(
        [
          {
            command: 'open',
            positionals: ['Settings'],
            args: ['unexpected'],
          } as unknown as BatchStep,
        ],
        10,
      ),
    /unknown field\(s\): "args"/i,
  );
});
