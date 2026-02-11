import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBootFailure } from '../boot-diagnostics.ts';
import { AppError } from '../../utils/errors.ts';

test('classifyBootFailure maps timeout errors', () => {
  const reason = classifyBootFailure({ message: 'bootstatus timed out after 120s' });
  assert.equal(reason, 'BOOT_TIMEOUT');
});

test('classifyBootFailure maps adb offline errors', () => {
  const reason = classifyBootFailure({ stderr: 'error: device offline' });
  assert.equal(reason, 'DEVICE_OFFLINE');
});

test('classifyBootFailure maps tool missing from AppError code', () => {
  const reason = classifyBootFailure({
    error: new AppError('TOOL_MISSING', 'adb not found in PATH'),
  });
  assert.equal(reason, 'TOOL_MISSING');
});

test('classifyBootFailure reads stderr from AppError details', () => {
  const reason = classifyBootFailure({
    error: new AppError('COMMAND_FAILED', 'adb failed', {
      stderr: 'error: device unauthorized',
    }),
  });
  assert.equal(reason, 'PERMISSION_DENIED');
});
