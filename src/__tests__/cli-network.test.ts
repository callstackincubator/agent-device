import { test } from 'vitest';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCliCapture } from './cli-capture.ts';

function makeFailedReplayResult() {
  return {
    file: '/tmp/02-fail.ad',
    session: 'default:test:suite:2',
    status: 'failed',
    durationMs: 5,
    attempts: 2,
    artifactsDir: '/tmp/test-artifacts/02-fail',
    error: { message: 'Replay failed at step 1 (open Demo): boom' },
  };
}

function makeReplaySuiteResponse() {
  const failedReplayResult = makeFailedReplayResult();

  return {
    ok: true as const,
    data: {
      total: 3,
      executed: 2,
      passed: 1,
      failed: 1,
      skipped: 1,
      notRun: 0,
      durationMs: 25,
      failures: [failedReplayResult],
      tests: [
        {
          file: '/tmp/01-pass.ad',
          session: 'default:test:suite:1',
          status: 'passed',
          durationMs: 10,
          attempts: 1,
        },
        failedReplayResult,
        {
          file: '/tmp/03-skip.ad',
          status: 'skipped',
          durationMs: 0,
          message: 'missing platform metadata for --platform android',
        },
      ],
    },
  };
}

test('network dump prints parsed entries and metadata', async () => {
  const result = await runCliCapture(['network', 'dump', '10', '--include', 'all'], async () => ({
    ok: true,
    data: {
      path: '/tmp/app.log',
      include: 'all',
      active: true,
      state: 'active',
      backend: 'android',
      scannedLines: 120,
      matchedLines: 2,
      entries: [
        {
          timestamp: '2026-02-24T10:00:01Z',
          method: 'POST',
          url: 'https://api.example.com/v1/login',
          status: 401,
          durationMs: 377,
          headers: '{"x-id":"abc"}',
          requestBody: '{"email":"u@example.com"}',
          responseBody: '{"error":"denied"}',
        },
      ],
      notes: ['best-effort parser'],
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  const request = result.calls[0];
  assert.ok(request);
  assert.deepEqual(request.positionals, ['dump', '10']);
  assert.equal(request.flags?.networkInclude, 'all');
  assert.match(result.stdout, /\/tmp\/app\.log/);
  assert.match(
    result.stdout,
    /2026-02-24T10:00:01Z POST https:\/\/api\.example\.com\/v1\/login status=401 durationMs=377/,
  );
  assert.match(result.stdout, /headers:/);
  assert.match(result.stdout, /request:/);
  assert.match(result.stdout, /response:/);
  assert.match(result.stderr, /active=true/);
  assert.match(result.stderr, /include=all/);
  assert.match(result.stderr, /matchedLines=2/);
  assert.match(result.stderr, /best-effort parser/);
});

test('test command prints suite summary and exits non-zero on failures', async () => {
  const result = await runCliCapture(['test', './suite'], async () => makeReplaySuiteResponse());

  assert.equal(result.code, 1);
  assert.equal(result.calls.length, 1);
  assert.match(result.stderr, /Running replay suite\.\.\./);
  assert.doesNotMatch(result.stdout, /PASS \/tmp\/01-pass\.ad/);
  assert.match(result.stdout, /FAIL \/tmp\/02-fail\.ad after 2 attempts \(5ms\)/);
  assert.match(result.stdout, /Replay failed at step 1 \(open Demo\): boom/);
  assert.match(result.stdout, /artifacts: \/tmp\/test-artifacts\/02-fail/);
  assert.doesNotMatch(result.stdout, /SKIP \/tmp\/03-skip\.ad/);
  assert.match(result.stdout, /Test summary: 1 passed, 1 failed in 25ms/);
});

test('test command --verbose prints all test statuses', async () => {
  const result = await runCliCapture(['test', './suite', '--verbose'], async () =>
    makeReplaySuiteResponse(),
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Running replay suite\.\.\./);
  assert.match(result.stdout, /PASS \/tmp\/01-pass\.ad \(10ms\)/);
  assert.match(result.stdout, /SKIP \/tmp\/03-skip\.ad/);
});

test('test command reports flaky passed-on-retry cases in the default summary', async () => {
  const result = await runCliCapture(['test', './suite'], async () => ({
    ok: true,
    data: {
      total: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      notRun: 0,
      durationMs: 25,
      failures: [],
      tests: [
        {
          file: '/tmp/01-flaky.ad',
          session: 'default:test:suite:1',
          status: 'passed',
          durationMs: 10,
          attempts: 2,
        },
      ],
    },
  }));

  assert.equal(result.code, null);
  assert.match(result.stderr, /Running replay suite\.\.\./);
  assert.match(result.stdout, /FLAKY \/tmp\/01-flaky\.ad after 2 attempts \(10ms\)/);
  assert.match(result.stdout, /Test summary: 1 passed, 0 failed, 1 flaky in 25ms/);
});

test('test command writes JUnit report with failure metadata', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-device-junit-test-'));
  const reportPath = path.join(tmpDir, 'replays.junit.xml');

  try {
    const result = await runCliCapture(
      ['test', './suite', '--report-junit', reportPath],
      async () => ({
        ok: true,
        data: {
          total: 3,
          executed: 3,
          passed: 1,
          failed: 1,
          skipped: 1,
          notRun: 0,
          durationMs: 25,
          failures: [
            {
              file: '/tmp/02-fail.ad',
              session: 'default:test:suite:2',
              status: 'failed',
              durationMs: 5,
              attempts: 2,
              artifactsDir: '/tmp/test-artifacts/02-fail',
              error: {
                message: 'Replay failed at step 1 (open Demo): boom',
                hint: 'retry me',
                diagnosticId: 'diag-123',
                logPath: '/tmp/diag.ndjson',
              },
            },
          ],
          tests: [
            {
              file: '/tmp/01-flaky.ad',
              session: 'default:test:suite:1',
              status: 'passed',
              durationMs: 10,
              attempts: 2,
              replayed: 1,
              healed: 0,
            },
            {
              file: '/tmp/02-fail.ad',
              session: 'default:test:suite:2',
              status: 'failed',
              durationMs: 5,
              attempts: 2,
              artifactsDir: '/tmp/test-artifacts/02-fail',
              error: {
                message: 'Replay failed at step 1 (open Demo): boom',
                hint: 'retry me',
                diagnosticId: 'diag-123',
                logPath: '/tmp/diag.ndjson',
              },
            },
            {
              file: '/tmp/03-skip.ad',
              status: 'skipped',
              durationMs: 0,
              message: 'not runnable',
              reason: 'skipped-by-filter',
            },
          ],
        },
      }),
    );

    assert.equal(result.code, 1);
    const xml = await fs.readFile(reportPath, 'utf8');
    assert.match(
      xml,
      /<testsuite name="agent-device replay suite" tests="3" failures="1" skipped="1" time="0\.025">/,
    );
    assert.match(
      xml,
      /<testcase classname="\/tmp" name="02-fail\.ad" file="\/tmp\/02-fail\.ad" time="0\.005">/,
    );
    assert.match(xml, /<failure message="Replay failed at step 1 \(open Demo\): boom">/);
    assert.match(xml, /diagnosticId: diag-123/);
    assert.match(xml, /logPath: \/tmp\/diag\.ndjson/);
    assert.match(xml, /artifactsDir: \/tmp\/test-artifacts\/02-fail/);
    assert.match(xml, /flaky: true/);
    assert.match(xml, /<skipped message="not runnable" \/>/);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
