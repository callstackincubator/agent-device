import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTriggerAppEventArgs, normalizeTriggerAliasCommand } from '../app-events.ts';
import { AppError } from '../../utils/errors.ts';

test('normalizeTriggerAliasCommand maps aliases to trigger-app-event', () => {
  const normalized = normalizeTriggerAliasCommand('trigger-screenshot-notification', []);
  assert.equal(normalized.command, 'trigger-app-event');
  assert.deepEqual(normalized.positionals, ['screenshot_taken']);
});

test('normalizeTriggerAliasCommand rejects alias arguments', () => {
  assert.throws(
    () => normalizeTriggerAliasCommand('trigger-device-shake', ['extra']),
    (error) => error instanceof AppError && error.code === 'INVALID_ARGS',
  );
});

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
