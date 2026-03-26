import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  assertReplaySuiteResult,
  formatResultDebug,
  runCliJson,
  withIntegrationLock,
} from './test-helpers.ts';

const macosReplaySuitePath = path.resolve('test/integration/replays/macos');
const macosReplayScreenshotPath = path.resolve(
  'test/screenshots/replays/macos-system-settings.png',
);

test('macos system settings commands', { skip: shouldSkipMacos() }, async () => {
  await withIntegrationLock('platform-replay-suites', async () => {
    rmSync(macosReplayScreenshotPath, { force: true });
    const args = ['test', macosReplaySuitePath, '--json'];
    const result = runCliJson(args);

    assertReplaySuiteResult('macos replay suite', args, result, {
      total: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      notRun: 0,
    });
    assert.equal(
      existsSync(macosReplayScreenshotPath),
      true,
      formatResultDebug('macos screenshot', args, result),
    );
  });
});

function shouldSkipMacos(): boolean {
  return process.platform !== 'darwin';
}
