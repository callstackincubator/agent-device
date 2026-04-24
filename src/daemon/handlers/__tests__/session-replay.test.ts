import assert from 'node:assert/strict';
import { test } from 'vitest';
import { buildReplayActionFlags, withReplayFailureContext } from '../session-replay-runtime.ts';
import { buildNestedReplayFlags } from '../session-replay.ts';

test('buildReplayActionFlags keeps allowed parent flags only', () => {
  const flags = buildReplayActionFlags(
    {
      platform: 'android',
      device: 'Pixel',
      out: '/tmp/out.json',
      saveScript: true,
    },
    {
      out: '/tmp/action.json',
    },
  );

  assert.equal(flags.platform, 'android');
  assert.equal(flags.device, 'Pixel');
  assert.equal(flags.out, '/tmp/action.json');
  assert.equal(flags.saveScript, undefined);
});

test('withReplayFailureContext annotates replay step details', () => {
  const response = withReplayFailureContext(
    {
      ok: false,
      error: {
        code: 'COMMAND_FAILED',
        message: 'tap failed',
      },
    },
    {
      ts: 1,
      command: 'click',
      positionals: ['text=Submit'],
      flags: {},
    },
    1,
    '/tmp/flow.ad',
    ['/tmp/snapshot.json'],
  );

  assert.equal(response.ok, false);
  if (!response.ok) {
    assert.match(response.error.message, /Replay failed at step 2/i);
    assert.equal(response.error.details?.replayPath, '/tmp/flow.ad');
    assert.deepEqual(response.error.details?.artifactPaths, ['/tmp/snapshot.json']);
  }
});

test('buildNestedReplayFlags returns parent flags untouched when neither override is set', () => {
  const parent = { platform: 'android' as const, timeoutMs: 5000 };
  const result = buildNestedReplayFlags({
    parentFlags: parent,
    platform: undefined,
    artifactsDir: undefined,
  });
  assert.strictEqual(result, parent);
});

test('buildNestedReplayFlags merges platform and artifactsDir into parent flags', () => {
  const parent = { timeoutMs: 5000, retries: 1 };
  const result = buildNestedReplayFlags({
    parentFlags: parent,
    platform: 'ios',
    artifactsDir: '/tmp/attempt-1',
  });
  assert.deepEqual(result, {
    timeoutMs: 5000,
    retries: 1,
    platform: 'ios',
    artifactsDir: '/tmp/attempt-1',
  });
  // Parent object must not be mutated.
  assert.equal((parent as Record<string, unknown>).artifactsDir, undefined);
});

test('buildNestedReplayFlags threads artifactsDir through even when parent lacks it', () => {
  const result = buildNestedReplayFlags({
    parentFlags: undefined,
    platform: undefined,
    artifactsDir: '/tmp/attempt-1',
  });
  assert.deepEqual(result, { artifactsDir: '/tmp/attempt-1' });
});

test('buildNestedReplayFlags overrides a parent artifactsDir with the attempt-level one', () => {
  const result = buildNestedReplayFlags({
    parentFlags: { artifactsDir: '/suite-root' },
    platform: undefined,
    artifactsDir: '/suite-root/flow/attempt-2',
  });
  assert.equal(result?.artifactsDir, '/suite-root/flow/attempt-2');
});
