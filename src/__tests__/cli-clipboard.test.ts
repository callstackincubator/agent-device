import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runCliCapture } from './cli-capture.ts';

test('clipboard read prints clipboard text', async () => {
  const result = await runCliCapture(['clipboard', 'read'], async () => ({
    ok: true,
    data: { action: 'read', text: 'otp-123456' },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.command, 'clipboard');
  assert.deepEqual(result.calls[0]?.positionals, ['read']);
  assert.equal(result.stdout, 'otp-123456\n');
  assert.equal(result.stderr, '');
});

test('clipboard write prints update confirmation', async () => {
  const result = await runCliCapture(['clipboard', 'write', 'hello'], async () => ({
    ok: true,
    data: { action: 'write', textLength: 5, message: 'Clipboard updated' },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.command, 'clipboard');
  assert.deepEqual(result.calls[0]?.positionals, ['write', 'hello']);
  assert.equal(result.stdout, 'Clipboard updated\n');
  assert.equal(result.stderr, '');
});
