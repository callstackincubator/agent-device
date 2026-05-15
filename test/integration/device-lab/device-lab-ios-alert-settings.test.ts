import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'vitest';
import { createAgentDeviceClient } from '../../../src/client.ts';
import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import type { AppleToolProvider } from '../../../src/platforms/ios/tool-provider.ts';
import type { DeviceInfo } from '../../../src/utils/device.ts';
import { startDeviceLabDaemon, withDeviceLabRemoteEnv } from './http-harness.ts';
import { createProviderTranscript } from './transcript.ts';

const iosSimulator: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone 15',
  kind: 'simulator',
  target: 'mobile',
  booted: true,
};

test('Device Lab iOS Settings permission and alert flow uses provider seams', async () => {
  const runnerTranscript = createProviderTranscript([
    {
      command: 'ios.runner.alert',
      deviceId: iosSimulator.id,
      platform: 'ios',
      request: { command: 'alert', action: 'get', appBundleId: 'com.apple.Preferences' },
      result: { title: 'Camera Access', message: 'Allow Settings to access Camera?' },
    },
    {
      command: 'ios.runner.alert',
      deviceId: iosSimulator.id,
      platform: 'ios',
      request: { command: 'alert', action: 'accept', appBundleId: 'com.apple.Preferences' },
      result: { action: 'accept', accepted: true },
    },
  ]);
  const appleRunnerProvider: AppleRunnerProvider = {
    runCommand: async (device, command) =>
      runnerTranscript.next(`ios.runner.${command.command}`, command, {
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
            '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"sim-1","state":"Booted","isAvailable":true}]}}\n',
          stderr: '',
          exitCode: 0,
        };
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
    },
  };
  const daemon = await startDeviceLabDaemon({
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleToolProvider,
    deviceInventoryProvider: async () => [iosSimulator],
  });

  try {
    await withDeviceLabRemoteEnv(daemon, async () => {
      const client = createAgentDeviceClient();
      const selection = { platform: 'ios' as const, udid: iosSimulator.id };

      const open = await client.apps.open({ app: 'com.apple.Preferences', ...selection });
      assert.equal(open.device?.id, iosSimulator.id);

      const logsPath = await client.observability.logs({ action: 'path', ...selection });
      assert.equal(logsPath.active, false);

      const logsMark = await client.observability.logs({
        action: 'mark',
        message: 'before-camera-permission',
        ...selection,
      });
      assert.equal(logsMark.marked, true);
      assert.match(fs.readFileSync(String(logsMark.path), 'utf8'), /before-camera-permission/);

      const logsDoctor = await client.observability.logs({ action: 'doctor', ...selection });
      assert.equal((logsDoctor.checks as { simctlAvailable?: boolean }).simctlAvailable, true);

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
    });

    runnerTranscript.assertComplete();
    assert.ok(
      appleToolCalls.some((call) =>
        arrayEqual(call, [
          'xcrun',
          'simctl',
          'privacy',
          'sim-1',
          'grant',
          'camera',
          'com.apple.Preferences',
        ]),
      ),
      JSON.stringify(appleToolCalls),
    );
  } finally {
    await daemon.close();
  }
});

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
