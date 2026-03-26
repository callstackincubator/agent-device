import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReplayActionFlags, withReplayFailureContext } from '../session-replay-runtime.ts';

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
