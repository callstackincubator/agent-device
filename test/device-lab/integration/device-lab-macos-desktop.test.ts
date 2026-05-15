import assert from 'node:assert/strict';
import { test } from 'vitest';
import type { AppleToolProvider } from '../../../src/platforms/ios/tool-provider.ts';
import type { DeviceInfo } from '../../../src/utils/device.ts';
import { startDeviceLabDaemon } from '../http-harness.ts';
import { runDeviceLabScenario } from '../scenario.ts';

const macOsDevice: DeviceInfo = {
  platform: 'macos',
  id: 'host-macos',
  name: 'Mac desktop',
  kind: 'device',
  target: 'desktop',
  booted: true,
};

test('Device Lab macOS desktop flow uses scripted Apple tools', async () => {
  let clipboardText = '';
  const toolCalls: Array<[string, string[]]> = [];
  const appleToolProvider: AppleToolProvider = {
    whichCommand: async () => true,
    runCommandSync: (cmd, args) => {
      throw new Error(`Unexpected sync Apple tool command: ${cmd} ${args.join(' ')}`);
    },
    runCommand: async (cmd, args, options) => {
      toolCalls.push([cmd, args]);
      if (cmd === 'find') {
        return {
          stdout: '/Applications/System Settings.app\n',
          stderr: '',
          exitCode: 0,
        };
      }
      if (cmd === 'plutil') {
        const key = args[1];
        if (key === 'CFBundleIdentifier') {
          return { stdout: 'com.apple.systempreferences\n', stderr: '', exitCode: 0 };
        }
        if (key === 'CFBundleName') {
          return { stdout: 'System Settings\n', stderr: '', exitCode: 0 };
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
    },
  };
  const daemon = await startDeviceLabDaemon({
    appleToolProvider: () => appleToolProvider,
    deviceInventoryProvider: async () => [macOsDevice],
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
        name: 'list installed apps',
        command: 'apps',
        assert: (apps) => {
          assert.deepEqual(apps.json?.result?.data?.apps, [
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
    ]);

    assert.deepEqual(
      scenario.steps.map((step) => step.command),
      [
        'open',
        'apps',
        'appstate',
        'logs',
        'clipboard',
        'clipboard',
        'settings',
        'open',
        'snapshot',
        'press',
      ],
    );

    assertToolCall(toolCalls, ['open', '-b', 'com.apple.systempreferences']);
    assertToolCall(toolCalls, [
      'find',
      '/Applications',
      '-maxdepth',
      '4',
      '-type',
      'd',
      '-name',
      '*.app',
    ]);
    assertToolCall(toolCalls, [
      'plutil',
      '-extract',
      'CFBundleIdentifier',
      'raw',
      '-o',
      '-',
      '/Applications/System Settings.app/Contents/Info.plist',
    ]);
    assertToolCall(toolCalls, ['pbcopy']);
    assertToolCall(toolCalls, ['pbpaste']);
    assertToolCall(toolCalls, [
      'osascript',
      '-e',
      'tell application "System Events" to tell appearance preferences to set dark mode to true',
    ]);
    assertToolCallStartsWith(toolCalls, ['agent-device-macos-helper', 'snapshot', '--surface']);
    assertToolCall(toolCalls, [
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

function assertToolCall(calls: Array<[string, string[]]>, expected: [string, ...string[]]): void {
  assert.ok(
    calls.some(([cmd, args]) => arrayEqual([cmd, ...args], expected)),
    `Expected Apple tool call ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

function assertToolCallStartsWith(
  calls: Array<[string, string[]]>,
  expected: [string, ...string[]],
): void {
  assert.ok(
    calls.some(([cmd, args]) => arrayStartsWith([cmd, ...args], expected)),
    `Expected Apple tool call starting with ${JSON.stringify(expected)} in ${JSON.stringify(calls)}`,
  );
}

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function arrayStartsWith(left: readonly string[], right: readonly string[]): boolean {
  return right.every((value, index) => left[index] === value);
}
