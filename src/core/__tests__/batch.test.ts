import { test } from 'vitest';
import assert from 'node:assert/strict';
import { validateAndNormalizeBatchSteps } from '../batch.ts';
import type { BatchStep } from '../dispatch.ts';

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
