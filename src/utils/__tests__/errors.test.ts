import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, asAppError, normalizeError } from '../errors.ts';

test('normalizeError adds default hint and strips diagnostic metadata from details', () => {
  const err = new AppError('COMMAND_FAILED', 'runner failed', {
    token: 'secret',
    hint: 'custom hint',
    diagnosticId: 'diag-1',
    logPath: '/tmp/diag.log',
    safe: 'ok',
  });
  const normalized = normalizeError(err);
  assert.equal(normalized.code, 'COMMAND_FAILED');
  assert.equal(normalized.message, 'runner failed');
  assert.equal(normalized.hint, 'custom hint');
  assert.equal(normalized.diagnosticId, 'diag-1');
  assert.equal(normalized.logPath, '/tmp/diag.log');
  assert.equal(normalized.details?.token, '[REDACTED]');
  assert.equal(normalized.details?.safe, 'ok');
  assert.equal(Object.hasOwn(normalized.details ?? {}, 'hint'), false);
});

test('normalizeError falls back to context metadata', () => {
  const err = new AppError('INVALID_ARGS', 'bad argument');
  const normalized = normalizeError(err, {
    diagnosticId: 'diag-ctx',
    logPath: '/tmp/context.log',
  });
  assert.equal(normalized.diagnosticId, 'diag-ctx');
  assert.equal(normalized.logPath, '/tmp/context.log');
  assert.match(normalized.hint ?? '', /help/i);
});

test('asAppError wraps unknown errors', () => {
  const err = asAppError(new Error('unexpected'));
  assert.equal(err.code, 'UNKNOWN');
  assert.equal(err.message, 'unexpected');
});
