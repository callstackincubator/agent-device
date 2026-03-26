import test from 'node:test';
import path from 'node:path';
import { assertReplaySuiteResult, runCliJson, withIntegrationLock } from './test-helpers.ts';

const androidReplaySuitePath = path.resolve('test/integration/replays/android');

test('android settings commands', async () => {
  await withIntegrationLock('platform-replay-suites', async () => {
    const args = ['test', androidReplaySuitePath, '--json'];
    const result = runCliJson(args);

    assertReplaySuiteResult('android replay suite', args, result, {
      total: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      notRun: 0,
    });
  });
});
