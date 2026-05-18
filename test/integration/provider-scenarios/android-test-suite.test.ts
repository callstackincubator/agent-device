import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import { createAndroidSettingsWorld } from './android-world.ts';
import { withProviderScenarioResource } from './harness.ts';

test('Provider-backed integration Android replay test suite covers retries and fail-fast flags', async () => {
  await withProviderScenarioResource(createAndroidSettingsWorld, async (world) => {
    const client = world.daemon.client();
    const suiteRoot = path.join(world.tempRoot, 'suite-flags');
    fs.mkdirSync(suiteRoot, { recursive: true });

    const passingScript = path.join(suiteRoot, '01-pass.ad');
    fs.writeFileSync(
      passingScript,
      [
        'context platform=android',
        'open settings',
        'snapshot -i',
        'is visible label=Apps',
        '',
      ].join('\n'),
    );
    const passingSuite = await client.replay.test({
      paths: [passingScript],
      retries: 1,
      artifactsDir: path.join(suiteRoot, 'passing-artifacts'),
      ...world.selection,
    });
    assert.equal(passingSuite.total, 1, JSON.stringify(passingSuite));
    assert.equal(passingSuite.passed, 1, JSON.stringify(passingSuite));
    assert.equal(passingSuite.failed, 0, JSON.stringify(passingSuite));
    const passingTests = passingSuite.tests as Array<Record<string, unknown>>;
    assert.equal(passingTests[0]?.attempts, 1, JSON.stringify(passingSuite));

    const failFastRoot = path.join(suiteRoot, 'fail-fast');
    fs.mkdirSync(failFastRoot, { recursive: true });
    fs.writeFileSync(
      path.join(failFastRoot, '01-fail.ad'),
      [
        'context platform=android',
        'open settings',
        'snapshot -i',
        'is visible label=Missing',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(failFastRoot, '02-not-run.ad'),
      [
        'context platform=android',
        'open settings',
        'snapshot -i',
        'is visible label=Apps',
        '',
      ].join('\n'),
    );
    const failFastSuite = await client.replay.test({
      paths: [failFastRoot],
      failFast: true,
      artifactsDir: path.join(suiteRoot, 'fail-fast-artifacts'),
      ...world.selection,
    });
    assert.equal(failFastSuite.total, 2, JSON.stringify(failFastSuite));
    assert.equal(failFastSuite.executed, 1, JSON.stringify(failFastSuite));
    assert.equal(failFastSuite.failed, 1, JSON.stringify(failFastSuite));
    assert.equal(failFastSuite.notRun, 1, JSON.stringify(failFastSuite));
  });
});
