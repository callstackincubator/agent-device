import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emitDiagnostic,
  flushDiagnosticsToSessionFile,
  withDiagnosticTimer,
  withDiagnosticsScope,
} from '../diagnostics.ts';

test('diagnostics writes NDJSON entries with timer metadata', async () => {
  const previousHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-diag-home-'));
  process.env.HOME = tempHome;
  try {
    const outputPath = await withDiagnosticsScope(
      {
        session: 'diag-session',
        requestId: 'r1',
        command: 'open',
      },
      async () => {
        emitDiagnostic({ phase: 'request_start', level: 'info', data: { platform: 'ios' } });
        await withDiagnosticTimer('platform_command', async () => await Promise.resolve());
        return flushDiagnosticsToSessionFile({ force: true });
      },
    );

    assert.equal(typeof outputPath, 'string');
    assert.ok(outputPath);
    assert.equal(fs.existsSync(outputPath as string), true);
    const rows = fs.readFileSync(outputPath as string, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(rows.length >= 2, true);
    assert.equal(rows[0]?.phase, 'request_start');
    const timed = rows.find((row) => row.phase === 'platform_command');
    assert.equal(typeof timed?.durationMs, 'number');
  } finally {
    process.env.HOME = previousHome;
  }
});

test('diagnostics redacts sensitive fields', async () => {
  const previousHome = process.env.HOME;
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-device-diag-redact-'));
  process.env.HOME = tempHome;
  try {
    const outputPath = await withDiagnosticsScope(
      {
        session: 'redaction-session',
        requestId: 'r2',
        command: 'fill',
      },
      async () => {
        emitDiagnostic({
          phase: 'request_failed',
          level: 'error',
          data: {
            token: 'secret-token',
            text: 'sensitive text',
            nested: { authorization: 'Bearer abc' },
            safe: 'ok',
          },
        });
        return flushDiagnosticsToSessionFile({ force: true });
      },
    );

    assert.ok(outputPath);
    const rows = fs.readFileSync(outputPath as string, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    const payload = rows[0]?.data ?? {};
    assert.equal(payload.token, '[REDACTED]');
    assert.equal(payload.text, 'sensitive text');
    assert.equal(payload.nested?.authorization, '[REDACTED]');
    assert.equal(payload.safe, 'ok');
  } finally {
    process.env.HOME = previousHome;
  }
});
