import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'vitest';
import type { AppleToolProvider } from '../../../src/platforms/ios/tool-provider.ts';
import { assertFlatToolCall } from './assertions.ts';
import {
  createDemoIosApp,
  DEVICE_LAB_IOS_REINSTALL_DEVICE,
  DEVICE_LAB_IOS_SIMULATOR,
} from './fixtures.ts';
import { startDeviceLabDaemon } from './http-harness.ts';
import { createAppleRunnerProviderFromTranscript } from './providers.ts';
import { runDeviceLabScenario } from './scenario.ts';
import { createProviderTranscript } from './transcript.ts';

test('Device Lab iOS Settings flow uses scripted xcrun and runner providers', async () => {
  const runnerTranscript = createProviderTranscript([
    runnerSnapshot(),
    runnerSnapshot(),
    {
      command: 'ios.runner.tap',
      deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
      platform: 'ios',
      request: { command: 'tap', x: 196, y: 122, appBundleId: 'com.apple.Preferences' },
      result: { tapped: true },
    },
    runnerSnapshot(),
    runnerSnapshot(),
    {
      command: 'ios.runner.findText',
      deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
      platform: 'ios',
      request: {
        command: 'findText',
        text: 'General',
        appBundleId: 'com.apple.Preferences',
      },
      result: { found: true },
    },
    {
      command: 'ios.runner.keyboardDismiss',
      deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
      platform: 'ios',
      request: { command: 'keyboardDismiss', appBundleId: 'com.apple.Preferences' },
      result: { dismissed: true },
    },
  ]);
  const appleRunnerProvider = createAppleRunnerProviderFromTranscript(
    runnerTranscript,
    'ios.runner',
  );
  const appleToolCalls: Array<[string, ...string[]]> = [];
  let clipboardText = '';
  const appleToolProvider: AppleToolProvider = {
    whichCommand: async () => true,
    runCommand: async (cmd, args) => {
      appleToolCalls.push([cmd, ...args]);
      if (cmd === 'xcrun' && args.join(' ') === 'simctl pbcopy sim-1') {
        clipboardText = 'runner otp 246810';
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (cmd === 'xcrun' && args.join(' ') === 'simctl pbpaste sim-1') {
        return { stdout: `${clipboardText}\n`, stderr: '', exitCode: 0 };
      }
      if (cmd === 'xcrun' && args.join(' ') === 'simctl list devices -j') {
        return {
          stdout:
            '{"devices":{"com.apple.CoreSimulator.SimRuntime.iOS-18-0":[{"name":"iPhone 15","udid":"sim-1","state":"Booted","isAvailable":true}]}}\n',
          stderr: '',
          exitCode: 0,
        };
      }
      if (cmd === 'xcrun' && args.join(' ') === 'simctl listapps sim-1') {
        return {
          stdout:
            '{"com.apple.Maps":{"CFBundleDisplayName":"Maps"},"com.example.demo":{"CFBundleDisplayName":"Demo"}}\n',
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
    deviceInventoryProvider: async () => [DEVICE_LAB_IOS_SIMULATOR],
  });
  const { tempRoot, appPath } = createDemoIosApp('agent-device-lab-ios-deploy-');

  try {
    const scenario = await runDeviceLabScenario(daemon, [
      {
        name: 'open settings app',
        command: 'open',
        positionals: ['com.apple.Preferences'],
        flags: { platform: 'ios', udid: DEVICE_LAB_IOS_SIMULATOR.id },
        expectData: {
          appBundleId: 'com.apple.Preferences',
          device_udid: DEVICE_LAB_IOS_SIMULATOR.id,
        },
      },
      {
        name: 'read app session state',
        command: 'appstate',
        flags: { platform: 'ios', udid: DEVICE_LAB_IOS_SIMULATOR.id },
        expectData: {
          platform: 'ios',
          appBundleId: 'com.apple.Preferences',
          source: 'session',
          device_udid: DEVICE_LAB_IOS_SIMULATOR.id,
          ios_simulator_device_set: null,
        },
      },
      {
        name: 'capture settings snapshot',
        command: 'snapshot',
        flags: { snapshotInteractiveOnly: true },
        assert: (firstSnapshot) => {
          assert.equal(firstSnapshot.json?.result?.data?.nodes?.[0]?.label, 'General');
          assert.equal(firstSnapshot.json?.result?.data?.nodes?.[0]?.ref, 'e1');
        },
      },
      {
        name: 'reopen existing session app',
        command: 'open',
        positionals: ['com.apple.Preferences'],
        expectData: { appBundleId: 'com.apple.Preferences' },
      },
      {
        name: 'reinstall demo app',
        command: 'reinstall',
        positionals: ['com.example.demo', appPath],
        expectData: { platform: 'ios', bundleId: 'com.example.demo', appPath },
      },
      {
        name: 'install demo app',
        command: 'install',
        positionals: ['com.example.demo', appPath],
        expectData: { platform: 'ios', bundleId: 'com.example.demo', appPath },
      },
      {
        name: 'list user apps by default',
        command: 'apps',
        assert: (apps) => {
          assert.deepEqual(apps.json?.result?.data?.apps, ['Demo (com.example.demo)']);
        },
      },
      {
        name: 'list all apps with flag',
        command: 'apps',
        flags: { appsFilter: 'all' },
        assert: (apps) => {
          assert.deepEqual(apps.json?.result?.data?.apps, [
            'Maps (com.apple.Maps)',
            'Demo (com.example.demo)',
          ]);
        },
      },
      {
        name: 'refresh snapshot after install',
        command: 'snapshot',
        flags: { snapshotInteractiveOnly: true },
      },
      {
        name: 'press snapshot ref',
        command: 'press',
        positionals: ['@e1'],
        expectData: { x: 196, y: 122 },
      },
      {
        name: 'get ref attrs',
        command: 'get',
        positionals: ['attrs', '@e1'],
        assert: (getAttrs) => {
          assert.equal(getAttrs.json?.result?.data?.node?.label, 'General');
        },
      },
      {
        name: 'assert visible selector',
        command: 'is',
        positionals: ['visible', 'label=General'],
        expectData: { pass: true },
      },
      {
        name: 'find attrs by label',
        command: 'find',
        positionals: ['label', 'General', 'get', 'attrs'],
        expectData: { ref: '@e1' },
      },
      {
        name: 'wait for text',
        command: 'wait',
        positionals: ['text', 'General', '100'],
        expectData: { text: 'General' },
      },
      {
        name: 'write clipboard',
        command: 'clipboard',
        positionals: ['write', 'runner otp 246810'],
        expectData: { textLength: 17 },
      },
      {
        name: 'read clipboard',
        command: 'clipboard',
        positionals: ['read'],
        expectData: { text: 'runner otp 246810' },
      },
      {
        name: 'dismiss keyboard',
        command: 'keyboard',
        positionals: ['dismiss'],
        expectData: { platform: 'ios', action: 'dismiss', dismissed: true },
      },
      { name: 'close settings session', command: 'close' },
      {
        name: 'list sessions after close',
        command: 'session_list',
        assert: (list) => {
          assert.deepEqual(list.json?.result?.data?.sessions, []);
        },
      },
    ]);

    assert.deepEqual(
      scenario.steps.map((step) => step.command),
      [
        'open',
        'appstate',
        'snapshot',
        'open',
        'reinstall',
        'install',
        'apps',
        'apps',
        'snapshot',
        'press',
        'get',
        'is',
        'find',
        'wait',
        'clipboard',
        'clipboard',
        'keyboard',
        'close',
        'session_list',
      ],
    );

    runnerTranscript.assertComplete();
    assertFlatToolCall(appleToolCalls, [
      'xcrun',
      'simctl',
      'launch',
      'sim-1',
      'com.apple.Preferences',
    ]);
    assertFlatToolCall(appleToolCalls, [
      'xcrun',
      'simctl',
      'uninstall',
      'sim-1',
      'com.example.demo',
    ]);
    assertFlatToolCall(appleToolCalls, [
      'plutil',
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Info.plist'),
    ]);
    assertFlatToolCall(appleToolCalls, [
      'plutil',
      '-extract',
      'CFBundleDisplayName',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Info.plist'),
    ]);
    assertFlatToolCall(appleToolCalls, [
      'plutil',
      '-extract',
      'CFBundleName',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Info.plist'),
    ]);
    assertFlatToolCall(appleToolCalls, ['xcrun', 'simctl', 'install', 'sim-1', appPath]);
    assertFlatToolCall(appleToolCalls, ['xcrun', 'simctl', 'pbcopy', 'sim-1']);
    assertFlatToolCall(appleToolCalls, ['xcrun', 'simctl', 'pbpaste', 'sim-1']);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    await daemon.close();
  }
});

test('Device Lab iOS physical reinstall uses scripted devicectl provider', async () => {
  const appleToolCalls: Array<[string, ...string[]]> = [];
  const appleToolProvider: AppleToolProvider = {
    whichCommand: async () => true,
    runCommand: async (cmd, args) => {
      appleToolCalls.push([cmd, ...args]);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
  const daemon = await startDeviceLabDaemon({
    appleToolProvider: () => appleToolProvider,
    deviceInventoryProvider: async () => [DEVICE_LAB_IOS_REINSTALL_DEVICE],
  });
  const { tempRoot, appPath } = createDemoIosApp('agent-device-lab-ios-physical-deploy-');

  try {
    const reinstall = await daemon.callCommand('reinstall', ['com.example.demo', appPath], {
      platform: 'ios',
      udid: DEVICE_LAB_IOS_REINSTALL_DEVICE.id,
    });
    assert.equal(reinstall.statusCode, 200, JSON.stringify(reinstall.json));
    assert.equal(reinstall.json?.result?.data?.platform, 'ios');
    assert.equal(reinstall.json?.result?.data?.bundleId, 'com.example.demo');
    assert.equal(reinstall.json?.result?.data?.appPath, appPath);
    assertFlatToolCall(appleToolCalls, [
      'xcrun',
      'devicectl',
      'device',
      'uninstall',
      'app',
      '--device',
      DEVICE_LAB_IOS_REINSTALL_DEVICE.id,
      'com.example.demo',
    ]);
    assertFlatToolCall(appleToolCalls, [
      'xcrun',
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      DEVICE_LAB_IOS_REINSTALL_DEVICE.id,
      appPath,
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    await daemon.close();
  }
});

function runnerSnapshot() {
  return {
    command: 'ios.runner.snapshot',
    deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
    platform: 'ios' as const,
    result: {
      nodes: [
        {
          index: 0,
          type: 'XCUIElementTypeCell',
          label: 'General',
          identifier: 'General',
          rect: { x: 16, y: 100, width: 360, height: 44 },
          enabled: true,
          hittable: true,
        },
      ],
      truncated: false,
    },
  };
}
