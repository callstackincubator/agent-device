import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import type { AppleToolProvider } from '../../../src/platforms/ios/tool-provider.ts';
import type { DeviceInfo } from '../../../src/utils/device.ts';
import { startDeviceLabDaemon } from '../http-harness.ts';
import { runDeviceLabScenario } from '../scenario.ts';
import { createProviderTranscript } from '../transcript.ts';

const iosDevice: DeviceInfo = {
  platform: 'ios',
  id: 'sim-1',
  name: 'iPhone 15',
  kind: 'simulator',
  target: 'mobile',
  booted: true,
};

const iosPhysicalDevice: DeviceInfo = {
  platform: 'ios',
  id: 'device-1',
  name: 'iPhone Device',
  kind: 'device',
  target: 'mobile',
  booted: true,
};

test('Device Lab iOS Settings flow uses scripted xcrun and runner providers', async () => {
  const runnerTranscript = createProviderTranscript([
    runnerSnapshot(),
    runnerSnapshot(),
    {
      command: 'ios.runner.tap',
      deviceId: iosDevice.id,
      platform: 'ios',
      request: { command: 'tap', x: 196, y: 122, appBundleId: 'com.apple.Preferences' },
      result: { tapped: true },
    },
    runnerSnapshot(),
    runnerSnapshot(),
    {
      command: 'ios.runner.findText',
      deviceId: iosDevice.id,
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
      deviceId: iosDevice.id,
      platform: 'ios',
      request: { command: 'keyboardDismiss', appBundleId: 'com.apple.Preferences' },
      result: { dismissed: true },
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
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };

  const daemon = await startDeviceLabDaemon({
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleToolProvider,
    deviceInventoryProvider: async () => [iosDevice],
  });
  const { tempRoot, appPath } = createDemoApp('agent-device-lab-ios-deploy-');

  try {
    const scenario = await runDeviceLabScenario(daemon, [
      {
        name: 'open settings app',
        command: 'open',
        positionals: ['com.apple.Preferences'],
        flags: { platform: 'ios', udid: iosDevice.id },
        expectData: { appBundleId: 'com.apple.Preferences', device_udid: iosDevice.id },
      },
      {
        name: 'read app session state',
        command: 'appstate',
        flags: { platform: 'ios', udid: iosDevice.id },
        expectData: {
          platform: 'ios',
          appBundleId: 'com.apple.Preferences',
          source: 'session',
          device_udid: iosDevice.id,
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
    assertAppleToolCall(appleToolCalls, [
      'xcrun',
      'simctl',
      'launch',
      'sim-1',
      'com.apple.Preferences',
    ]);
    assertAppleToolCall(appleToolCalls, [
      'xcrun',
      'simctl',
      'uninstall',
      'sim-1',
      'com.example.demo',
    ]);
    assertAppleToolCall(appleToolCalls, [
      'plutil',
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Info.plist'),
    ]);
    assertAppleToolCall(appleToolCalls, [
      'plutil',
      '-extract',
      'CFBundleDisplayName',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Info.plist'),
    ]);
    assertAppleToolCall(appleToolCalls, [
      'plutil',
      '-extract',
      'CFBundleName',
      'raw',
      '-o',
      '-',
      path.join(appPath, 'Info.plist'),
    ]);
    assertAppleToolCall(appleToolCalls, ['xcrun', 'simctl', 'install', 'sim-1', appPath]);
    assertAppleToolCall(appleToolCalls, ['xcrun', 'simctl', 'pbcopy', 'sim-1']);
    assertAppleToolCall(appleToolCalls, ['xcrun', 'simctl', 'pbpaste', 'sim-1']);
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
    deviceInventoryProvider: async () => [iosPhysicalDevice],
  });
  const { tempRoot, appPath } = createDemoApp('agent-device-lab-ios-physical-deploy-');

  try {
    const reinstall = await daemon.callCommand('reinstall', ['com.example.demo', appPath], {
      platform: 'ios',
      udid: iosPhysicalDevice.id,
    });
    assert.equal(reinstall.statusCode, 200, JSON.stringify(reinstall.json));
    assert.equal(reinstall.json?.result?.data?.platform, 'ios');
    assert.equal(reinstall.json?.result?.data?.bundleId, 'com.example.demo');
    assert.equal(reinstall.json?.result?.data?.appPath, appPath);
    assertAppleToolCall(appleToolCalls, [
      'xcrun',
      'devicectl',
      'device',
      'uninstall',
      'app',
      '--device',
      iosPhysicalDevice.id,
      'com.example.demo',
    ]);
    assertAppleToolCall(appleToolCalls, [
      'xcrun',
      'devicectl',
      'device',
      'install',
      'app',
      '--device',
      iosPhysicalDevice.id,
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
    deviceId: iosDevice.id,
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

function createDemoApp(prefix: string): { tempRoot: string; appPath: string } {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const appPath = path.join(tempRoot, 'Demo.app');
  fs.mkdirSync(appPath, { recursive: true });
  fs.writeFileSync(
    path.join(appPath, 'Info.plist'),
    [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      '<key>CFBundleIdentifier</key><string>com.example.demo</string>',
      '<key>CFBundleName</key><string>Demo</string>',
      '</dict></plist>',
    ].join(''),
    'utf8',
  );
  return { tempRoot, appPath };
}

function assertAppleToolCall(
  calls: Array<[string, ...string[]]>,
  expected: [string, ...string[]],
): void {
  assert.ok(
    calls.some((call) => arrayEqual(call, expected)),
    `Expected Apple tool call ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
