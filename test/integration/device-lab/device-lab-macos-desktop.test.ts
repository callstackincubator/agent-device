import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertFlatToolCall, assertFlatToolCallStartsWith } from './assertions.ts';
import { DEVICE_LAB_MACOS } from './fixtures.ts';
import { createDeviceLabHarness } from './harness.ts';
import { createRecordingAppleToolProvider } from './providers.ts';
import { assertScenarioCommands, runDeviceLabScenario } from './scenario.ts';

test('Device Lab macOS desktop flow uses scripted Apple tools', async () => {
  let clipboardText = '';
  const appleTool = createRecordingAppleToolProvider(async (cmd, args, options) => {
    if (cmd === 'find') {
      return {
        stdout: '/Applications/System Settings.app\n/Applications/Demo.app\n',
        stderr: '',
        exitCode: 0,
      };
    }
    if (cmd === 'plutil') {
      const key = args[1];
      const plistPath = args[5] ?? '';
      const isDemo = plistPath.includes('/Demo.app/');
      if (key === 'CFBundleIdentifier') {
        return {
          stdout: isDemo ? 'com.example.demo\n' : 'com.apple.systempreferences\n',
          stderr: '',
          exitCode: 0,
        };
      }
      if (key === 'CFBundleName') {
        return { stdout: isDemo ? 'Demo\n' : 'System Settings\n', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 1 };
    }
    if (cmd === 'pbcopy') {
      clipboardText = String(options?.stdin ?? '');
      return { stdout: '', stderr: '', exitCode: 0 };
    }
    if (cmd === 'pbpaste') {
      return { stdout: `${clipboardText}\n`, stderr: '', exitCode: 0 };
    }
    if (cmd === 'agent-device-macos-helper') {
      return runScriptedMacOsHelper(args);
    }
    return { stdout: '', stderr: '', exitCode: 0 };
  });
  const daemon = await createDeviceLabHarness({
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_MACOS],
  });

  try {
    const scenario = await runDeviceLabScenario(daemon, [
      {
        name: 'open settings app',
        command: 'open',
        positionals: ['settings'],
        flags: { platform: 'macos' },
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
            'Demo (com.example.demo)',
            'System Settings (com.apple.systempreferences)',
          ]);
        },
      },
      {
        name: 'read app session state',
        command: 'appstate',
        expectData: {
          platform: 'macos',
          appName: 'settings',
          appBundleId: 'com.apple.systempreferences',
          source: 'session',
          surface: 'app',
        },
      },
      {
        name: 'read logs path',
        command: 'logs',
        expectData: { active: false, backend: 'macos' },
        assert: (logsPath) => {
          assert.equal(typeof logsPath.json?.result?.data?.path, 'string');
        },
      },
      {
        name: 'write clipboard',
        command: 'clipboard',
        positionals: ['write', 'desktop otp 123456'],
        expectData: { textLength: 18 },
      },
      {
        name: 'read clipboard',
        command: 'clipboard',
        positionals: ['read'],
        expectData: { text: 'desktop otp 123456' },
      },
      {
        name: 'set dark appearance',
        command: 'settings',
        positionals: ['appearance', 'dark'],
        expectData: { setting: 'appearance', state: 'dark' },
      },
      {
        name: 'switch to frontmost desktop surface',
        command: 'open',
        flags: {
          platform: 'macos',
          surface: 'frontmost-app',
        },
        expectData: {
          surface: 'frontmost-app',
          appBundleId: 'com.apple.systempreferences',
        },
      },
      {
        name: 'capture frontmost snapshot',
        command: 'snapshot',
        flags: { snapshotInteractiveOnly: true },
        assert: (snapshot) => {
          const general = snapshot.json?.result?.data?.nodes?.find(
            (node: { label?: string }) => node.label === 'General',
          );
          assert.equal(general?.ref, 'e2', JSON.stringify(snapshot.json));
        },
      },
      {
        name: 'press snapshot ref',
        command: 'press',
        positionals: ['@e2'],
        expectData: { x: 116, y: 80 },
      },
      {
        name: 'switch to desktop surface',
        command: 'open',
        flags: {
          platform: 'macos',
          surface: 'desktop',
        },
        expectData: {
          surface: 'desktop',
          appBundleId: undefined,
        },
      },
      {
        name: 'read desktop surface state',
        command: 'appstate',
        expectData: {
          platform: 'macos',
          appName: 'desktop',
          appBundleId: undefined,
          source: 'session',
          surface: 'desktop',
        },
      },
    ]);

    assertScenarioCommands(scenario, [
      'open',
      'apps',
      'apps',
      'appstate',
      'logs',
      'clipboard',
      'clipboard',
      'settings',
      'open',
      'snapshot',
      'press',
      'open',
      'appstate',
    ]);

    assertFlatToolCall(appleTool.calls, ['open', '-b', 'com.apple.systempreferences']);
    assertFlatToolCall(appleTool.calls, [
      'find',
      '/Applications',
      '-maxdepth',
      '4',
      '-type',
      'd',
      '-name',
      '*.app',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'plutil',
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      '/Applications/System Settings.app/Contents/Info.plist',
    ]);
    assertFlatToolCall(appleTool.calls, ['pbcopy']);
    assertFlatToolCall(appleTool.calls, ['pbpaste']);
    assertFlatToolCall(appleTool.calls, [
      'osascript',
      '-e',
      'tell application "System Events" to tell appearance preferences to set dark mode to true',
    ]);
    assertFlatToolCallStartsWith(appleTool.calls, [
      'agent-device-macos-helper',
      'snapshot',
      '--surface',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'agent-device-macos-helper',
      'press',
      '--x',
      '116',
      '--y',
      '80',
      '--bundle-id',
      'com.apple.systempreferences',
      '--surface',
      'frontmost-app',
    ]);
  } finally {
    await daemon.close();
  }
});

function runScriptedMacOsHelper(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  if (args[0] === 'app' && args[1] === 'frontmost') {
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          bundleId: 'com.apple.systempreferences',
          appName: 'System Settings',
          pid: 42,
        },
      })}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  if (args[0] === 'snapshot') {
    const surface = args[args.indexOf('--surface') + 1] ?? 'frontmost-app';
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          surface,
          nodes: [
            {
              index: 0,
              depth: 0,
              type: 'Application',
              label: 'System Settings',
              surface,
              bundleId: 'com.apple.systempreferences',
              appName: 'System Settings',
            },
            {
              index: 1,
              depth: 1,
              parentIndex: 0,
              type: 'Button',
              label: 'General',
              surface,
              rect: { x: 80, y: 56, width: 72, height: 48 },
              enabled: true,
              hittable: true,
            },
          ],
          truncated: false,
          backend: 'macos-helper',
        },
      })}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  if (args[0] === 'press') {
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          x: Number(args[args.indexOf('--x') + 1]),
          y: Number(args[args.indexOf('--y') + 1]),
          bundleId: 'com.apple.systempreferences',
          surface: 'frontmost-app',
        },
      })}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  return {
    stdout: `${JSON.stringify({ ok: false, error: { message: 'Unexpected helper command' } })}\n`,
    stderr: '',
    exitCode: 1,
  };
}
