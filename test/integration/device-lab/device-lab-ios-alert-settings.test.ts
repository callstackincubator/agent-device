import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import type { AppLogProvider } from '../../../src/daemon/app-log.ts';
import { assertFlatToolCall } from './assertions.ts';
import { DEVICE_LAB_IOS_SIMULATOR } from './fixtures.ts';
import { createDeviceLabHarness } from './harness.ts';
import {
  createAppleRunnerProviderFromTranscript,
  createRecordingAppleToolProvider,
  simctlListDevicesJson,
} from './providers.ts';
import { createProviderTranscript } from './transcript.ts';

test('Device Lab iOS Settings permission and alert flow uses provider seams', async () => {
  const runnerTranscript = createProviderTranscript([
    {
      command: 'ios.runner.alert',
      deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
      platform: 'ios',
      request: { command: 'alert', action: 'get', appBundleId: 'com.apple.Preferences' },
      result: { title: 'Camera Access', message: 'Allow Settings to access Camera?' },
    },
    {
      command: 'ios.runner.alert',
      deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
      platform: 'ios',
      request: { command: 'alert', action: 'accept', appBundleId: 'com.apple.Preferences' },
      result: { action: 'accept', accepted: true },
    },
  ]);
  const appleRunnerProvider = createAppleRunnerProviderFromTranscript(
    runnerTranscript,
    'ios.runner',
  );
  const appleTool = createRecordingAppleToolProvider(async (cmd, args) => {
    if (cmd === 'xcrun' && args.join(' ') === 'simctl list devices -j') {
      return simctlListDevicesJson('com.apple.CoreSimulator.SimRuntime.iOS-18-0', [
        { name: 'iPhone 15', udid: 'sim-1' },
      ]);
    }
    if (cmd === 'xcrun' && args.join(' ') === 'simctl privacy help') {
      return {
        stdout: [
          'service',
          '  camera - Camera',
          '  microphone - Microphone',
          'bundle identifier',
        ].join('\n'),
        stderr: '',
        exitCode: 0,
      };
    }
    if (cmd === 'xcrun' && args.join(' ') === 'simctl help') {
      return { stdout: 'simctl help\n', stderr: '', exitCode: 0 };
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  let appLogStopped = false;
  const appLogStarts: Array<{ appBundleId: string; outPath: string }> = [];
  const appLogProvider: AppLogProvider = {
    start: async ({ appBundleId, outPath }) => {
      appLogStarts.push({ appBundleId, outPath });
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.appendFileSync(outPath, 'Settings log stream started\n', 'utf8');
      return {
        backend: 'ios-simulator',
        startedAt: Date.now(),
        getState: () => 'active',
        stop: async () => {
          appLogStopped = true;
        },
        wait: Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      };
    },
  };
  const daemon = await createDeviceLabHarness({
    appLogProvider: () => appLogProvider,
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_IOS_SIMULATOR],
  });

  try {
    {
      const client = daemon.client();
      const selection = { platform: 'ios' as const, udid: DEVICE_LAB_IOS_SIMULATOR.id };

      const open = await client.apps.open({ app: 'com.apple.Preferences', ...selection });
      assert.equal(open.device?.id, DEVICE_LAB_IOS_SIMULATOR.id);

      const logsPath = await client.observability.logs({ action: 'path', ...selection });
      assert.equal(logsPath.active, false);

      const logsStart = await client.observability.logs({ action: 'start', ...selection });
      assert.equal(logsStart.started, true);

      const activeLogsPath = await client.observability.logs({ action: 'path', ...selection });
      assert.equal(activeLogsPath.active, true);
      assert.equal(activeLogsPath.backend, 'ios-simulator');

      const logsStop = await client.observability.logs({ action: 'stop', ...selection });
      assert.equal(logsStop.stopped, true);

      const logsMark = await client.observability.logs({
        action: 'mark',
        message: 'before-camera-permission',
        ...selection,
      });
      assert.equal(logsMark.marked, true);
      assert.match(fs.readFileSync(String(logsMark.path), 'utf8'), /before-camera-permission/);

      const logsDoctor = await client.observability.logs({ action: 'doctor', ...selection });
      assert.equal((logsDoctor.checks as { simctlAvailable?: boolean }).simctlAvailable, true);

      await client.settings.update({ setting: 'appearance', state: 'dark', ...selection });

      await client.settings.update({
        setting: 'location',
        state: 'set',
        latitude: 37.3349,
        longitude: -122.009,
        ...selection,
      });

      await client.settings.update({
        setting: 'permission',
        state: 'grant',
        permission: 'camera',
        ...selection,
      });

      const alertGet = await client.command.alert({ action: 'get', ...selection });
      assert.equal(alertGet.title, 'Camera Access');

      const alertAccept = await client.command.alert({ action: 'accept', ...selection });
      assert.equal(alertAccept.accepted, true);
    }

    runnerTranscript.assertComplete();
    assert.deepEqual(
      appLogStarts.map((start) => start.appBundleId),
      ['com.apple.Preferences'],
    );
    assert.equal(appLogStopped, true);
    assertFlatToolCall(appleTool.calls, ['xcrun', 'simctl', 'ui', 'sim-1', 'appearance', 'dark']);
    assertFlatToolCall(appleTool.calls, [
      'xcrun',
      'simctl',
      'location',
      'sim-1',
      'set',
      '37.3349,-122.009',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'xcrun',
      'simctl',
      'privacy',
      'sim-1',
      'grant',
      'camera',
      'com.apple.Preferences',
    ]);
  } finally {
    await daemon.close();
  }
});
