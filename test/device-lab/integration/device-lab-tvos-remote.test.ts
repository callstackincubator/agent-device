import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import type { AppleToolProvider } from '../../../src/platforms/ios/tool-provider.ts';
import type { DeviceInfo } from '../../../src/utils/device.ts';
import { startDeviceLabDaemon } from '../http-harness.ts';
import { createProviderTranscript } from '../transcript.ts';

const tvosDevice: DeviceInfo = {
  platform: 'ios',
  id: 'tv-sim-1',
  name: 'Apple TV',
  kind: 'simulator',
  target: 'tv',
  booted: true,
};

test('Device Lab tvOS remote flow maps navigation commands to runner remote presses', async () => {
  const runnerTranscript = createProviderTranscript([
    {
      command: 'tvos.runner.remotePress',
      deviceId: tvosDevice.id,
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
      deviceId: tvosDevice.id,
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
      deviceId: tvosDevice.id,
      platform: 'ios',
      request: {
        command: 'remotePress',
        remoteButton: 'home',
        appBundleId: 'com.example.tv',
      },
      result: { remoteButton: 'home' },
    },
  ]);
  const appleRunnerProvider: AppleRunnerProvider = {
    runCommand: async (device, command) =>
      runnerTranscript.next(`tvos.runner.${command.command}`, command, {
        deviceId: device.id,
        platform: device.platform,
      }) as Record<string, unknown>,
  };
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
    deviceInventoryProvider: async () => [tvosDevice],
  });

  try {
    const open = await daemon.callCommand('open', ['com.example.tv'], {
      platform: 'ios',
      target: 'tv',
      udid: tvosDevice.id,
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
