import type { AppleRunnerProvider } from '../../../src/platforms/ios/runner-provider.ts';
import { DEVICE_LAB_MACOS } from './fixtures.ts';
import { createDeviceLabHarness, type DeviceLabHarness } from './harness.ts';
import { createRecordingAppleToolProvider, type FlatToolCall } from './providers.ts';

export type MacOsDesktopWorld = {
  daemon: DeviceLabHarness;
  appleTool: {
    calls: FlatToolCall[];
  };
  close: () => Promise<void>;
};

export async function createMacOsDesktopWorld(
  options: {
    appleRunnerProvider?: AppleRunnerProvider;
  } = {},
): Promise<MacOsDesktopWorld> {
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
    appleRunnerProvider: options.appleRunnerProvider
      ? () => options.appleRunnerProvider
      : undefined,
    appleToolProvider: () => appleTool.provider,
    deviceInventoryProvider: async () => [DEVICE_LAB_MACOS],
  });
  return {
    daemon,
    appleTool,
    close: async () => await daemon.close(),
  };
}

function runScriptedMacOsHelper(args: string[]): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  if (args[0] === 'app' && args[1] === 'frontmost') {
    return helperOk({
      bundleId: 'com.apple.systempreferences',
      appName: 'System Settings',
      pid: 42,
    });
  }
  if (args[0] === 'snapshot') {
    const surface = args[args.indexOf('--surface') + 1] ?? 'frontmost-app';
    const bundleId = args.includes('--bundle-id')
      ? args[args.indexOf('--bundle-id') + 1]
      : undefined;
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
              type: 'Application',
              label: 'Notes',
              surface,
              bundleId: 'com.apple.Notes',
              appName: 'Notes',
            },
            {
              index: 2,
              depth: 2,
              parentIndex: 1,
              type: 'Window',
              label: 'Notes',
              surface,
              bundleId: 'com.apple.Notes',
              appName: 'Notes',
              windowTitle: 'Notes',
              rect: { x: 32, y: 48, width: 640, height: 480 },
            },
            {
              index: 3,
              depth: 3,
              parentIndex: 2,
              type: 'StaticText',
              label: 'Pinned',
              surface,
              rect: { x: 40, y: 60, width: 80, height: 24 },
            },
          ]
        : surface === 'menubar'
          ? [
              {
                index: 0,
                depth: 0,
                type: 'MenuBarSurface',
                label: 'Menu Bar',
                surface,
              },
              {
                index: 1,
                depth: 1,
                parentIndex: 0,
                type: 'MenuBarItem',
                label: bundleId ? 'Demo' : 'File',
                surface,
                ...(bundleId ? { bundleId, appName: 'Demo' } : {}),
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
    return helperOk({
      surface,
      nodes,
      truncated: false,
      backend: 'macos-helper',
    });
  }
  if (args[0] === 'press') {
    const surface = args[args.indexOf('--surface') + 1] ?? 'frontmost-app';
    return helperOk({
      x: Number(args[args.indexOf('--x') + 1]),
      y: Number(args[args.indexOf('--y') + 1]),
      bundleId: 'com.apple.systempreferences',
      surface,
    });
  }
  if (args[0] === 'permission') {
    return helperOk({
      action: args[1],
      target: args[2],
      granted: args[1] === 'grant',
      requested: true,
      openedSettings: false,
    });
  }
  if (args[0] === 'alert') {
    return helperOk({
      title: 'System Events Wants to Control System Settings',
      role: 'AXSheet',
      buttons: ['OK', 'Cancel'],
      action: args[1],
      bundleId: 'com.apple.systempreferences',
    });
  }
  if (args[0] === 'read') {
    return helperOk({
      text: 'System Settings General pane',
    });
  }
  return {
    stdout: `${JSON.stringify({ ok: false, error: { message: 'Unexpected helper command' } })}\n`,
    stderr: '',
    exitCode: 1,
  };
}

function helperOk(data: Record<string, unknown>): { stdout: string; stderr: string; exitCode: 0 } {
  return {
    stdout: `${JSON.stringify({ ok: true, data })}\n`,
    stderr: '',
    exitCode: 0,
  };
}
