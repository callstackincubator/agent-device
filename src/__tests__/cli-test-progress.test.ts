import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatReplayTestProgressEvent } from '../cli-test-progress.ts';
import type { RequestProgressEvent } from '../daemon/request-progress.ts';

test('formatReplayTestProgressEvent renders replay suite start context', () => {
  const line = formatReplayTestProgressEvent({
    type: 'replay-test-suite',
    status: 'start',
    total: 4,
    runnable: 3,
    skipped: 1,
    artifactsDir: '/tmp/replay-suite',
    shardMode: 'split',
    shardCount: 2,
  });

  assert.equal(
    line,
    [
      'Running replay suite: 4 files',
      '  sharding: split across 2 devices',
      '  artifacts: /tmp/replay-suite',
    ].join('\n'),
  );
});

test('formatReplayTestProgressEvent renders replay test start context with shard metadata', () => {
  const line = formatReplayTestProgressEvent({
    type: 'replay-test',
    file: '/tmp/auth-flow.yml',
    title: 'Authentication flow',
    status: 'start',
    index: 2,
    total: 5,
    session: 'maestro-test:test:suite:2:attempt-1',
    artifactsDir: '/tmp/replay-suite/auth-flow',
    shardIndex: 1,
    shardCount: 2,
    deviceId: 'E140A942-965C-4A92-AC63-F3B23756BE02',
  });

  assert.equal(
    line,
    [
      '[2/5] START "Authentication flow" in auth-flow.yml [shard 2/2 E140A942-965C-4A92-AC63-F3B23756BE02]',
      '  session: maestro-test:test:suite:2:attempt-1',
      '  artifacts: /tmp/replay-suite/auth-flow',
    ].join('\n'),
  );
});

test('formatReplayTestProgressEvent ignores unknown progress event types', () => {
  const line = formatReplayTestProgressEvent({
    type: 'future-progress-event',
    status: 'start',
  } as unknown as RequestProgressEvent);

  assert.equal(line, undefined);
});

test('formatReplayTestProgressEvent renders pass, retry, fail, and skip cases', () => {
  const cases: Array<{ event: RequestProgressEvent; expected: RegExp }> = [
    {
      event: {
        type: 'replay-test',
        file: '/tmp/01-login.ad',
        status: 'pass',
        index: 1,
        total: 3,
        attempt: 2,
        maxAttempts: 2,
        durationMs: 12_345,
      },
      expected: /^\[1\/3] PASS 01-login\.ad after 2 attempts \(total 12\.3s\)$/,
    },
    {
      event: {
        type: 'replay-test',
        file: '/tmp/02-checkout.ad',
        status: 'fail',
        index: 2,
        total: 3,
        attempt: 1,
        maxAttempts: 2,
        durationMs: 1_234,
        retrying: true,
        message: 'first attempt failed',
      },
      expected: /^\[2\/3] RETRY 02-checkout\.ad attempt 1\/2 \(1\.23s\)\n  first attempt failed$/,
    },
    {
      event: {
        type: 'replay-test',
        file: '/tmp/03-payment.ad',
        status: 'fail',
        index: 3,
        total: 3,
        attempt: 2,
        maxAttempts: 2,
        durationMs: 9_876,
        message: 'assertVisible failed',
        session: 'maestro-test:test:suite:3:attempt-2',
        artifactsDir: '/tmp/replay-suite/payment',
      },
      expected:
        /^\[3\/3] FAIL 03-payment\.ad after 2 attempts \(total 9\.88s\)\n  assertVisible failed\n  session: maestro-test:test:suite:3:attempt-2\n  artifacts: \/tmp\/replay-suite\/payment$/,
    },
    {
      event: {
        type: 'replay-test',
        file: '/tmp/04-skip.ad',
        status: 'skip',
        index: 4,
        total: 5,
        message: 'missing platform metadata for --platform ios',
      },
      expected: /^\[4\/5] SKIP 04-skip\.ad\n  missing platform metadata for --platform ios$/,
    },
  ];

  for (const { event, expected } of cases) {
    assert.match(formatReplayTestProgressEvent(event) ?? '', expected);
  }
});
