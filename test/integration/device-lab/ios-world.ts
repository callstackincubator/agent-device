import fs from 'node:fs';
import type { DeviceLabTranscript } from './transcript.ts';
import {
  createDemoIosApp,
  DEVICE_LAB_IOS_REINSTALL_DEVICE,
  DEVICE_LAB_IOS_SIMULATOR,
} from './fixtures.ts';
import { createDeviceLabHarness, type DeviceLabHarness } from './harness.ts';
import {
  createAppleRunnerProviderFromTranscript,
  createRecordingAppleToolProvider,
  type FlatToolCall,
  simctlListDevicesJson,
} from './providers.ts';
import { createProviderTranscript } from './transcript.ts';

export type IosSettingsWorld = {
  daemon: DeviceLabHarness;
  appleTool: { calls: FlatToolCall[] };
  runnerTranscript: DeviceLabTranscript;
  tempRoot: string;
  appPath: string;
  selection: { platform: 'ios'; udid: string };
  close: () => Promise<void>;
};

export async function createIosSettingsWorld(): Promise<IosSettingsWorld> {
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
    {
      command: 'ios.runner.pinch',
      deviceId: DEVICE_LAB_IOS_SIMULATOR.id,
      platform: 'ios',
      request: {
        command: 'pinch',
        scale: 0.8,
        x: 196,
        y: 122,
        appBundleId: 'com.apple.Preferences',
      },
      result: { pinched: true },
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
  let clipboardText = '';
  const appleTool = createRecordingAppleToolProvider(async (cmd, args, options) => {
    if (cmd === 'xcrun' && args.join(' ') === 'simctl pbcopy sim-1') {
      clipboardText = String(options?.stdin ?? '');
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmd === 'xcrun' && args.join(' ') === 'simctl pbpaste sim-1') {
      return { stdout: `${clipboardText}\n`, stderr: '', exitCode: 0 };
    }
    if (cmd === 'xcrun' && args.join(' ') === 'simctl list devices -j') {
      return simctlListDevicesJson('com.apple.CoreSimulator.SimRuntime.iOS-18-0', [
        { name: 'iPhone 15', udid: 'sim-1' },
      ]);
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
  });

  const daemon = await createDeviceLabHarness({
    appleRunnerProvider: () => appleRunnerProvider,
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_IOS_SIMULATOR],
  });
  const { tempRoot, appPath } = createDemoIosApp('agent-device-lab-ios-deploy-');
  let closed = false;
  return {
    daemon,
    appleTool,
    runnerTranscript,
    tempRoot,
    appPath,
    selection: { platform: 'ios', udid: DEVICE_LAB_IOS_SIMULATOR.id },
    close: async () => {
      if (closed) return;
      closed = true;
      fs.rmSync(tempRoot, { recursive: true, force: true });
      await daemon.close();
    },
  };
}

export type IosPhysicalReinstallWorld = {
  daemon: DeviceLabHarness;
  appleTool: { calls: FlatToolCall[] };
  tempRoot: string;
  appPath: string;
  selection: { platform: 'ios'; udid: string };
  close: () => Promise<void>;
};

export async function createIosPhysicalReinstallWorld(): Promise<IosPhysicalReinstallWorld> {
  const appleTool = createRecordingAppleToolProvider(async (_cmd, args) => {
    if (args.includes('info') && args.includes('details')) {
      const jsonOutputIndex = args.indexOf('--json-output');
      const jsonPath = jsonOutputIndex >= 0 ? args[jsonOutputIndex + 1] : undefined;
      if (jsonPath) {
        fs.writeFileSync(
          jsonPath,
          JSON.stringify({
            result: {
              device: { connectionProperties: { tunnelState: 'connected' } },
            },
          }),
          'utf8',
        );
      }
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  const daemon = await createDeviceLabHarness({
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_IOS_REINSTALL_DEVICE],
  });
  const { tempRoot, appPath } = createDemoIosApp('agent-device-lab-ios-physical-deploy-');
  let closed = false;
  return {
    daemon,
    appleTool,
    tempRoot,
    appPath,
    selection: { platform: 'ios', udid: DEVICE_LAB_IOS_REINSTALL_DEVICE.id },
    close: async () => {
      if (closed) return;
      closed = true;
      fs.rmSync(tempRoot, { recursive: true, force: true });
      await daemon.close();
    },
  };
}

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
