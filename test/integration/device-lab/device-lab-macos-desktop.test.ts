import assert from 'node:assert/strict';
import { test } from 'vitest';
import { assertFlatToolCall } from './assertions.ts';
import { DEVICE_LAB_MACOS } from './fixtures.ts';
import { createDeviceLabHarness } from './harness.ts';
import { createRecordingAppleToolProvider } from './providers.ts';
import { runDeviceLabScenario } from './scenario.ts';

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
    await runDeviceLabScenario(daemon, [
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
        name: 'grant accessibility permission through helper',
        command: 'settings',
        positionals: ['permission', 'grant', 'accessibility'],
        expectData: {
          action: 'grant',
          target: 'accessibility',
          granted: true,
          requested: true,
          openedSettings: false,
        },
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
        name: 'read frontmost automation alert through helper',
        command: 'alert',
        positionals: ['get'],
        expectData: {
          title: 'System Events Wants to Control System Settings',
          role: 'AXSheet',
          action: 'get',
          bundleId: 'com.apple.systempreferences',
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
          assert.equal(daemon.session()?.snapshot?.backend, 'macos-helper');
          assert.equal(daemon.session()?.snapshot?.nodes[0]?.surface, 'frontmost-app');
        },
      },
      {
        name: 'read snapshot ref text through helper',
        command: 'get',
        positionals: ['text', '@e2'],
        expectData: { text: 'System Settings General pane' },
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
      {
        name: 'capture desktop surface snapshot',
        command: 'snapshot',
        assert: (snapshot) => {
          assert.deepEqual(
            snapshot.json?.result?.data?.nodes?.map((node: { label?: string }) => node.label),
            ['Desktop', 'Notes'],
          );
          assert.equal(daemon.session()?.snapshot?.backend, 'macos-helper');
          assert.equal(daemon.session()?.snapshot?.nodes[0]?.surface, 'desktop');
        },
      },
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
    assertFlatToolCall(appleTool.calls, [
      'agent-device-macos-helper',
      'permission',
      'grant',
      'accessibility',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'agent-device-macos-helper',
      'alert',
      'get',
      '--surface',
      'frontmost-app',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'agent-device-macos-helper',
      'snapshot',
      '--surface',
      'frontmost-app',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'agent-device-macos-helper',
      'snapshot',
      '--surface',
      'desktop',
    ]);
    assertFlatToolCall(appleTool.calls, [
      'agent-device-macos-helper',
      'read',
      '--x',
      '116',
      '--y',
      '80',
      '--bundle-id',
      'com.apple.systempreferences',
      '--surface',
      'frontmost-app',
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
    const nodes =
      surface === 'desktop'
        ? [
            {
              index: 0,
              depth: 0,
              type: 'DesktopSurface',
              label: 'Desktop',
              surface,
            },
            {
              index: 1,
              depth: 1,
              parentIndex: 0,
              type: 'Window',
              label: 'Notes',
              surface,
              bundleId: 'com.apple.Notes',
              appName: 'Notes',
              windowTitle: 'Notes',
              rect: { x: 32, y: 48, width: 640, height: 480 },
            },
          ]
        : [
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
          ];
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          surface,
          nodes,
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
  if (args[0] === 'permission') {
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          action: args[1],
          target: args[2],
          granted: args[1] === 'grant',
          requested: true,
          openedSettings: false,
        },
      })}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  if (args[0] === 'alert') {
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          title: 'System Events Wants to Control System Settings',
          role: 'AXSheet',
          buttons: ['OK', 'Cancel'],
          action: args[1],
          bundleId: 'com.apple.systempreferences',
        },
      })}\n`,
      stderr: '',
      exitCode: 0,
    };
  }
  if (args[0] === 'read') {
    return {
      stdout: `${JSON.stringify({
        ok: true,
        data: {
          text: 'System Settings General pane',
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
