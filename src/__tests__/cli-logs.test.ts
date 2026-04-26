import { test } from 'vitest';
import assert from 'node:assert/strict';
import { runCliCapture } from './cli-capture.ts';

test('logs clear prints action metadata and forwards --restart flag', async () => {
  const result = await runCliCapture(['logs', 'clear', '--restart'], async () => ({
    ok: true,
    data: {
      path: '/tmp/app.log',
      cleared: true,
      restarted: true,
      removedRotatedFiles: 2,
    },
  }));

  assert.equal(result.code, null);
  assert.equal(result.calls.length, 1);
  assert.equal(result.calls[0]?.flags?.restart, true);
  assert.match(result.stdout, /\/tmp\/app\.log/);
  assert.match(result.stderr, /cleared=true/);
  assert.match(result.stderr, /restarted=true/);
  assert.match(result.stderr, /removedRotatedFiles=2/);
});
