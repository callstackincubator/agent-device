import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertRpcOk } from './assertions.ts';
import { DEVICE_LAB_TVOS } from './fixtures.ts';
import { createDeviceLabHarness } from './harness.ts';
import {
  createAppleRunnerProviderFromTranscript,
  createRecordingAppleToolProvider,
  simctlListDevicesJson,
} from './providers.ts';
import { createProviderTranscript } from './transcript.ts';

test('Device Lab tvOS remote flow maps navigation commands to runner remote presses', async () => {
  const runnerTranscript = createProviderTranscript([
    {
      command: 'tvos.runner.remotePress',
      deviceId: DEVICE_LAB_TVOS.id,
      platform: 'ios',
      request: {
        command: 'remotePress',
        remoteButton: 'down',
        appBundleId: 'com.example.tv',
      },
      result: { remoteButton: 'down' },
    },
    {
      command: 'tvos.runner.remotePress',
      deviceId: DEVICE_LAB_TVOS.id,
      platform: 'ios',
      request: {
        command: 'remotePress',
        remoteButton: 'menu',
        appBundleId: 'com.example.tv',
      },
      result: { remoteButton: 'menu' },
    },
    {
      command: 'tvos.runner.remotePress',
      deviceId: DEVICE_LAB_TVOS.id,
      platform: 'ios',
      request: {
        command: 'remotePress',
        remoteButton: 'home',
        appBundleId: 'com.example.tv',
      },
      result: { remoteButton: 'home' },
    },
  ]);
  const appleRunnerProvider = createAppleRunnerProviderFromTranscript(
    runnerTranscript,
    'tvos.runner',
  );
  const appleTool = createRecordingAppleToolProvider({
    simctl: async (args) => {
      if (args.join(' ') === 'list devices -j') {
        return simctlListDevicesJson('com.apple.CoreSimulator.SimRuntime.tvOS-18-0', [
          { name: 'Apple TV', udid: 'tv-sim-1' },
        ]);
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  });

  const daemon = await createDeviceLabHarness({
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_TVOS],
  });

  try {
    const open = await daemon.callCommand('open', ['com.example.tv'], {
      platform: 'ios',
      target: 'tv',
      udid: DEVICE_LAB_TVOS.id,
    });
    assertRpcOk(open);

    const scroll = await daemon.callCommand('scroll', ['down']);
    assert.equal(assertRpcOk(scroll).direction, 'down');

    const back = await daemon.callCommand('back');
    assertRpcOk(back);

    const home = await daemon.callCommand('home');
    assertRpcOk(home);

    const close = await daemon.callCommand('close', ['com.example.tv']);
    assertRpcOk(close);

    runnerTranscript.assertComplete();
    assert.deepEqual(appleTool.calls, [
      ['simctl', 'list', 'devices', '-j'],
      ['simctl', 'list', 'devices', '-j'],
      ['simctl', 'launch', 'tv-sim-1', 'com.example.tv'],
      ['simctl', 'list', 'devices', '-j'],
      ['simctl', 'terminate', 'tv-sim-1', 'com.example.tv'],
    ]);
  } finally {
    await daemon.close();
  }
});
