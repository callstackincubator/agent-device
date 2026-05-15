import assert from 'node:assert/strict';
import { test } from 'vitest';
import { createOrderedProviderTranscript, createProviderTranscript } from './transcript.ts';

test('provider transcript matches expected calls without requiring incidental order', () => {
  const transcript = createProviderTranscript([
    { command: 'ios.runner.snapshot', result: { ok: 'snapshot' } },
    { command: 'ios.runner.tap', request: { command: 'tap', x: 10, y: 20 }, result: { ok: 'tap' } },
  ]);

  assert.deepEqual(transcript.next('ios.runner.tap', { command: 'tap', x: 10, y: 20 }), {
    ok: 'tap',
  });
  assert.deepEqual(transcript.next('ios.runner.snapshot'), { ok: 'snapshot' });
  transcript.assertComplete();
});

test('ordered provider transcript remains available when ordering is the contract', () => {
  const transcript = createOrderedProviderTranscript([
    { command: 'ios.runner.snapshot', result: { ok: 'snapshot' } },
    { command: 'ios.runner.tap', result: { ok: 'tap' } },
  ]);

  assert.throws(
    () => transcript.next('ios.runner.tap'),
    /Provider command mismatch|Unexpected provider call/,
  );
});
