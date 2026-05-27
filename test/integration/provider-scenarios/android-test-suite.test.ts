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

test('Provider-backed integration Android Maestro replay uses fresh selector snapshots and content-lane swipes', async () => {
  let snapshots = 0;
  await withProviderScenarioResource(
    async () =>
      await createAndroidSettingsWorld({
        snapshotXml: () => {
          snapshots += 1;
          return androidMaestroReplayXml(
            snapshots === 1 ? '[16,24][374,80]' : '[100,300][260,360]',
          );
        },
      }),
    async (world) => {
      const client = world.daemon.client();
      const suiteRoot = path.join(world.tempRoot, 'suite-maestro');
      fs.mkdirSync(suiteRoot, { recursive: true });
      const flowPath = path.join(suiteRoot, 'maestro-flow.yaml');
      fs.writeFileSync(
        flowPath,
        [
          'appId: com.android.settings',
          '---',
          '- launchApp',
          '- assertVisible: Apps',
          '- tapOn: Search',
          '- swipe:',
          '    start: 90%, 50%',
          '    end: 10%, 50%',
          '    duration: 300',
          '',
        ].join('\n'),
      );

      const suite = await client.replay.test({
        paths: [flowPath],
        backend: 'maestro',
        artifactsDir: path.join(suiteRoot, 'artifacts'),
        timeoutMs: 30000,
        ...world.selection,
      });

      assert.equal(suite.total, 1, JSON.stringify(suite));
      assert.equal(suite.passed, 1, JSON.stringify(suite));
      assert.equal(suite.failed, 0, JSON.stringify(suite));
      assert.deepEqual(
        world.adbCalls.find((call) => call.slice(0, 3).join(' ') === 'shell input tap'),
        ['shell', 'input', 'tap', '180', '330'],
      );
      assert.deepEqual(
        world.adbCalls.find((call) => call.slice(0, 3).join(' ') === 'shell input swipe'),
        ['shell', 'input', 'swipe', '351', '390', '39', '390', '300'],
      );
      assert.equal(snapshots >= 2, true);
    },
  );
});

function androidMaestroReplayXml(searchBounds: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<hierarchy rotation="0">',
    '  <node index="0" text="" resource-id="com.android.settings:id/main_content_scrollable_container" class="android.widget.ScrollView" package="com.android.settings" content-desc="" bounds="[0,0][390,600]" clickable="false" enabled="true">',
    '    <node index="0" text="Apps" resource-id="android:id/title" class="android.widget.TextView" package="com.android.settings" content-desc="" bounds="[24,124][152,178]" clickable="true" enabled="true" focusable="true" focused="false" />',
    `    <node index="1" text="" resource-id="com.android.settings:id/search" class="android.widget.EditText" package="com.android.settings" content-desc="Search" bounds="${searchBounds}" clickable="true" enabled="true" focusable="true" focused="false" password="false" />`,
    '  </node>',
    '</hierarchy>',
  ].join('\n');
}
