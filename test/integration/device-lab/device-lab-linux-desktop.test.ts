import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import type { LinuxToolProvider } from '../../../src/platforms/linux/tool-provider.ts';
import { assertPngFile, validPng } from './assertions.ts';
import { DEVICE_LAB_LINUX } from './fixtures.ts';
import { restoreEnv, startDeviceLabDaemon } from './http-harness.ts';
import { assertScenarioCommands, runDeviceLabScenario } from './scenario.ts';

test('Device Lab Linux desktop flow uses scripted desktop tools', async () => {
  const previousSessionType = process.env.XDG_SESSION_TYPE;
  const previousWaylandDisplay = process.env.WAYLAND_DISPLAY;
  const previousAuthHook = process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;
  const previousPlatform = process.platform;
  const screenshotPath = path.join(os.tmpdir(), `agent-device-lab-linux-${Date.now()}.png`);
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  process.env.XDG_SESSION_TYPE = 'x11';
  delete process.env.WAYLAND_DISPLAY;
  delete process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;

  const toolCalls: Array<[string, string[]]> = [];
  let clipboardText = '';
  const linuxToolProvider: LinuxToolProvider = {
    whichCommand: async (cmd) =>
      cmd === 'gnome-calculator' ||
      cmd === 'xdotool' ||
      cmd === 'wmctrl' ||
      cmd === 'python3' ||
      cmd === 'scrot' ||
      cmd === 'xclip',
    runCommand: async (cmd, args, options) => {
      toolCalls.push([cmd, args]);
      if (cmd === 'python3') {
        return { stdout: linuxCalculatorSnapshotJson(), stderr: '', exitCode: 0 };
      }
      if (cmd === 'scrot') {
        fs.writeFileSync(String(args[0]), validPng());
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      if (cmd === 'xclip' && args.includes('-o')) {
        return { stdout: clipboardText, stderr: '', exitCode: 0 };
      }
      if (cmd === 'xclip') {
        clipboardText = String(options?.stdin ?? '');
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return { stdout: '', stderr: '', exitCode: 0 };
    },
  };
  const daemon = await startDeviceLabDaemon({
    linuxToolProvider: () => linuxToolProvider,
    deviceInventoryProvider: async () => [DEVICE_LAB_LINUX],
  });

  try {
    const scenario = await runDeviceLabScenario(daemon, [
      {
        name: 'open calculator app',
        command: 'open',
        positionals: ['gnome-calculator'],
        flags: { platform: 'linux' },
      },
      {
        name: 'capture interactive snapshot',
        command: 'snapshot',
        flags: { snapshotInteractiveOnly: true },
        assert: (snapshot) => {
          const digitFive = snapshot.json?.result?.data?.nodes?.find(
            (node: { label?: string }) => node.label === '5',
          );
          assert.equal(digitFive?.ref, 'e2', JSON.stringify(snapshot.json));
        },
      },
      {
        name: 'press snapshot ref',
        command: 'press',
        positionals: ['@e2'],
        expectData: { x: 60, y: 100 },
      },
      {
        name: 'press coordinates',
        command: 'press',
        positionals: ['42', '84'],
        expectData: { x: 42, y: 84 },
      },
      {
        name: 'secondary click coordinates',
        command: 'click',
        positionals: ['42', '84'],
        flags: { clickButton: 'secondary' },
        expectData: { button: 'secondary' },
      },
      {
        name: 'middle click coordinates',
        command: 'click',
        positionals: ['42', '84'],
        flags: { clickButton: 'middle' },
        expectData: { button: 'middle' },
      },
      {
        name: 'double tap coordinates',
        command: 'press',
        positionals: ['42', '84'],
        flags: { doubleTap: true },
        expectData: { doubleTap: true },
      },
      {
        name: 'focus coordinates',
        command: 'focus',
        positionals: ['42', '84'],
        expectData: { x: 42, y: 84 },
      },
      {
        name: 'long press coordinates',
        command: 'longpress',
        positionals: ['42', '84', '1'],
      },
      {
        name: 'swipe coordinates',
        command: 'swipe',
        positionals: ['10', '20', '30', '40', '16'],
        expectData: { timingMode: 'direct' },
      },
      {
        name: 'fill snapshot ref',
        command: 'fill',
        positionals: ['@e2', 'Seven'],
        flags: { delayMs: 1 },
        expectData: { text: 'Seven' },
      },
      {
        name: 'scroll by pixels',
        command: 'scroll',
        positionals: ['down'],
        flags: { pixels: 45 },
        expectData: { pixels: 45 },
      },
      {
        name: 'scroll up',
        command: 'scroll',
        positionals: ['up'],
        expectData: { direction: 'up' },
      },
      {
        name: 'type text',
        command: 'type',
        positionals: ['5'],
        expectData: { text: '5' },
      },
      {
        name: 'write clipboard',
        command: 'clipboard',
        positionals: ['write', 'linux otp 314159'],
        expectData: { textLength: 16 },
      },
      {
        name: 'read clipboard',
        command: 'clipboard',
        positionals: ['read'],
        expectData: { text: 'linux otp 314159' },
      },
      {
        name: 'capture screenshot artifact',
        command: 'screenshot',
        positionals: [screenshotPath],
        expectData: { path: screenshotPath },
        assert: () => {
          assertPngFile(screenshotPath);
        },
      },
      { name: 'navigate back', command: 'back' },
      { name: 'show desktop', command: 'home' },
      {
        name: 'close calculator app',
        command: 'close',
        positionals: ['gnome-calculator'],
      },
    ]);

    assertScenarioCommands(scenario, [
      'open',
      'snapshot',
      'press',
      'press',
      'click',
      'click',
      'press',
      'focus',
      'longpress',
      'swipe',
      'fill',
      'scroll',
      'scroll',
      'type',
      'clipboard',
      'clipboard',
      'screenshot',
      'back',
      'home',
      'close',
    ]);

    assert.deepEqual(normalizeToolCalls(toolCalls), [
      ['gnome-calculator', []],
      [
        'python3',
        [
          'atspi-dump.py',
          '--surface',
          'frontmost-app',
          '--max-nodes',
          '1500',
          '--max-depth',
          '12',
          '--max-apps',
          '24',
        ],
      ],
      ['xdotool', ['mousemove', '--sync', '60', '100']],
      ['xdotool', ['click', '1']],
      ['xdotool', ['mousemove', '--sync', '42', '84']],
      ['xdotool', ['click', '1']],
      ['xdotool', ['mousemove', '--sync', '42', '84']],
      ['xdotool', ['click', '3']],
      ['xdotool', ['mousemove', '--sync', '42', '84']],
      ['xdotool', ['click', '2']],
      ['xdotool', ['mousemove', '--sync', '42', '84']],
      ['xdotool', ['click', '--repeat', '2', '1']],
      ['xdotool', ['mousemove', '--sync', '42', '84']],
      ['xdotool', ['click', '1']],
      ['xdotool', ['mousemove', '--sync', '42', '84']],
      ['xdotool', ['mousedown', '1']],
      ['xdotool', ['mouseup', '1']],
      ['xdotool', ['mousemove', '--sync', '10', '20']],
      ['xdotool', ['mousedown', '1']],
      ['xdotool', ['mousemove', '--sync', '30', '40']],
      ['xdotool', ['mouseup', '1']],
      ['xdotool', ['mousemove', '--sync', '60', '100']],
      ['xdotool', ['click', '1']],
      ['xdotool', ['key', '--clearmodifiers', 'ctrl+a']],
      ['xdotool', ['type', '--delay', '1', '--clearmodifiers', '--', 'Seven']],
      ['xdotool', ['click', '--repeat', '3', '5']],
      ['xdotool', ['click', '--repeat', '5', '4']],
      ['xdotool', ['type', '--clearmodifiers', '--', '5']],
      ['xclip', ['-selection', 'clipboard']],
      ['xclip', ['-selection', 'clipboard', '-o']],
      ['scrot', [screenshotPath]],
      ['xdotool', ['key', '--clearmodifiers', 'alt+Left']],
      ['xdotool', ['key', '--clearmodifiers', 'super+d']],
      ['wmctrl', ['-c', 'gnome-calculator']],
    ]);
  } finally {
    await daemon.close();
    fs.rmSync(screenshotPath, { force: true });
    Object.defineProperty(process, 'platform', { value: previousPlatform, configurable: true });
    restoreEnv('XDG_SESSION_TYPE', previousSessionType);
    restoreEnv('WAYLAND_DISPLAY', previousWaylandDisplay);
    restoreEnv('AGENT_DEVICE_HTTP_AUTH_HOOK', previousAuthHook);
  }
});

function linuxCalculatorSnapshotJson(): string {
  return JSON.stringify({
    nodes: [
      {
        index: 0,
        role: 'frame',
        label: 'Calculator',
        rect: { x: 0, y: 0, width: 320, height: 480 },
        enabled: true,
        hittable: true,
        depth: 0,
      },
      {
        index: 1,
        role: 'push button',
        label: '5',
        rect: { x: 40, y: 80, width: 40, height: 40 },
        enabled: true,
        hittable: true,
        depth: 1,
        parentIndex: 0,
      },
    ],
    truncated: false,
  });
}

function normalizeToolCalls(calls: Array<[string, string[]]>): Array<[string, string[]]> {
  return calls.map(([cmd, args]) => [
    cmd,
    cmd === 'python3' && args[0] ? [args[0].split('/').at(-1) ?? args[0], ...args.slice(1)] : args,
  ]);
}
