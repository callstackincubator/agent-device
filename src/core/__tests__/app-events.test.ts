import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTriggerAppEventArgs } from '../app-events.ts';
import { AppError } from '../../utils/errors.ts';

test('parseTriggerAppEventArgs validates event name format', () => {
  assert.throws(
    () => parseTriggerAppEventArgs(['bad event']),
    (error) => error instanceof AppError && error.code === 'INVALID_ARGS',
  );
});

test('parseTriggerAppEventArgs accepts JSON object payload', () => {
  const parsed = parseTriggerAppEventArgs(['screenshot_taken', '{"source":"qa"}']);
  assert.equal(parsed.eventName, 'screenshot_taken');
  assert.deepEqual(parsed.payload, { source: 'qa' });
});
