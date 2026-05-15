import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AppleToolProvider } from '../../../src/platforms/ios/tool-provider.ts';
import { DEVICE_LAB_TVOS } from './fixtures.ts';
import { startDeviceLabDaemon } from './http-harness.ts';
import { createAppleRunnerProviderFromTranscript } from './providers.ts';
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
  const appleToolCalls: Array<[string, ...string[]]> = [];
  const appleToolProvider: AppleToolProvider = {
    whichCommand: async () => true,
    runCommand: async (cmd, args) => {
      appleToolCalls.push([cmd, ...args]);
      if (cmd === 'xcrun' && args.join(' ') === 'simctl list devices -j') {
        return {
          stdout:
            '{"devices":{"com.apple.CoreSimulator.SimRuntime.tvOS-18-0":[{"name":"Apple TV","udid":"tv-sim-1","state":"Booted","isAvailable":true}]}}\n',
          stderr: '',
          exitCode: 0,
        };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };

  const daemon = await startDeviceLabDaemon({
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleToolProvider,
    deviceInventoryProvider: async () => [DEVICE_LAB_TVOS],
  });

  try {
    const open = await daemon.callCommand('open', ['com.example.tv'], {
      platform: 'ios',
      target: 'tv',
      udid: DEVICE_LAB_TVOS.id,
    });
    assert.equal(open.statusCode, 200, JSON.stringify(open.json));

    const scroll = await daemon.callCommand('scroll', ['down']);
    assert.equal(scroll.statusCode, 200, JSON.stringify(scroll.json));
    assert.equal(scroll.json?.result?.data?.direction, 'down');

    const back = await daemon.callCommand('back');
    assert.equal(back.statusCode, 200, JSON.stringify(back.json));

    const home = await daemon.callCommand('home');
    assert.equal(home.statusCode, 200, JSON.stringify(home.json));

    const close = await daemon.callCommand('close', ['com.example.tv']);
    assert.equal(close.statusCode, 200, JSON.stringify(close.json));

    runnerTranscript.assertComplete();
    assert.deepEqual(appleToolCalls, [
      ['xcrun', 'simctl', 'list', 'devices', '-j'],
      ['xcrun', 'simctl', 'list', 'devices', '-j'],
      ['xcrun', 'simctl', 'launch', 'tv-sim-1', 'com.example.tv'],
      ['xcrun', 'simctl', 'list', 'devices', '-j'],
      ['xcrun', 'simctl', 'terminate', 'tv-sim-1', 'com.example.tv'],
    ]);
  } finally {
    await daemon.close();
  }
});
