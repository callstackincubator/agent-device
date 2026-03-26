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

const iosSimulatorReplaySuitePath = path.resolve('test/integration/replays/ios/simulator');
const iosPhysicalReplaySuitePath = path.resolve('test/integration/replays/ios/device');
const iosReplayScreenshotPath = path.resolve('test/screenshots/replays/ios-settings.png');
const iosPhysicalUdid = process.env.IOS_UDID?.trim();

test('ios settings commands', { skip: shouldSkipIos() }, async () => {
  await withIntegrationLock('platform-replay-suites', async () => {
    rmSync(iosReplayScreenshotPath, { force: true });
    const args = ['test', iosSimulatorReplaySuitePath, '--json'];
    const result = runCliJson(args);

    assertReplaySuiteResult('ios replay suite', args, result, {
      total: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      notRun: 0,
    });
    assert.equal(
      existsSync(iosReplayScreenshotPath),
      true,
      formatResultDebug('ios screenshot', args, result),
    );
  });
});

test('ios physical device core lifecycle', { skip: shouldSkipIosPhysicalDevice() }, async () => {
  await withIntegrationLock('platform-replay-suites', async () => {
    const args = [
      'test',
      iosPhysicalReplaySuitePath,
      '--json',
      '--udid',
      iosPhysicalUdid as string,
    ];
    const result = runCliJson(args);

    assertReplaySuiteResult('ios physical replay suite', args, result, {
      total: 1,
      executed: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      notRun: 0,
    });
  });
});

function shouldSkipIos(): boolean {
  return process.platform !== 'darwin';
}

function shouldSkipIosPhysicalDevice(): boolean {
  return process.platform !== 'darwin' || !iosPhysicalUdid || isCi();
}

function isCi(): boolean {
  return isEnvTruthy(process.env.CI);
}

function isEnvTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value ?? '').toLowerCase());
}
