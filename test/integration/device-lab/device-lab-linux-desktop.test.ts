import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { createLocalLinuxToolProvider } from '../../../src/platforms/linux/tool-provider.ts';
import { assertFlatToolCall, assertPngFile, assertToolCall, validPng } from './assertions.ts';
import { DEVICE_LAB_LINUX } from './fixtures.ts';
import { restoreEnv, createDeviceLabHarness } from './harness.ts';
import { runDeviceLabScenario } from './scenario.ts';

test('Device Lab Linux desktop flow uses semantic lifecycle provider and scripted tools', async () => {
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
  const desktopCalls: Array<[string, string]> = [];
  const semanticCalls: Array<[string, ...string[]]> = [];
  let clipboardText = '';
  const linuxToolProvider = createLocalLinuxToolProvider({
    whichCommand: async (cmd) =>
      cmd === 'gnome-calculator' || cmd === 'xdotool' || cmd === 'wmctrl',
    runCommand: async (cmd, args) => {
      toolCalls.push([cmd, args]);
      return { stdout: '', stderr: '', exitCode: 0 };
    },
    desktop: {
      openTarget: async (target) => {
        desktopCalls.push(['open', target]);
      },
      closeApp: async (app) => {
        desktopCalls.push(['close', app]);
      },
    },
    accessibility: {
      captureTree: async (surface) => {
        semanticCalls.push(['accessibility', surface]);
        return {
          nodes: linuxCalculatorSnapshotNodes(),
          truncated: false,
          surface,
        };
      },
    },
    clipboard: {
      readText: async () => {
        semanticCalls.push(['clipboard', 'read']);
        return clipboardText;
      },
      writeText: async (text) => {
        semanticCalls.push(['clipboard', 'write', text]);
        clipboardText = text;
      },
    },
    screenshot: {
      capture: async (outPath) => {
        semanticCalls.push(['screenshot', outPath]);
        fs.writeFileSync(outPath, validPng());
      },
    },
  });
  const daemon = await createDeviceLabHarness({
    linuxToolProvider: () => linuxToolProvider,
    deviceInventoryProvider: async () => [DEVICE_LAB_LINUX],
  });

  try {
    const devices = await daemon.client().devices.list({ platform: 'linux' });
    assert.equal(devices.length, 1);
    assert.equal(devices[0]?.platform, 'linux');
    assert.equal(devices[0]?.id, DEVICE_LAB_LINUX.id);
    assert.equal(devices[0]?.target, 'desktop');

    await runDeviceLabScenario(daemon, [
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
        name: 'scope snapshot to calculator frame with depth limit',
        command: 'snapshot',
        flags: { snapshotScope: '@e1', snapshotDepth: 0 },
        assert: (snapshot) => {
          assert.deepEqual(
            snapshot.json?.result?.data?.nodes?.map((node: { label?: string }) => node.label),
            ['Calculator'],
          );
        },
      },
      {
        name: 'scope snapshot to ref from previous broad snapshot source',
        command: 'snapshot',
        flags: { snapshotScope: '@e3' },
        assert: (snapshot) => {
          assert.deepEqual(
            snapshot.json?.result?.data?.nodes?.map((node: { label?: string }) => node.label),
            ['Clear'],
          );
        },
      },
      {
        name: 'refresh broad interactive snapshot after scoped output',
        command: 'snapshot',
        flags: { snapshotInteractiveOnly: true },
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
        name: 'fill coordinates',
        command: 'fill',
        positionals: ['42', '84', 'Eight'],
        flags: { delayMs: 1 },
        expectData: { x: 42, y: 84, text: 'Eight' },
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
    ]);

    const actions = daemon.session()?.actions ?? [];
    assert.ok(
      actions.some(
        (action) =>
          action.command === 'fill' &&
          action.positionals.join(' ') === '@e2 Seven' &&
          action.flags.delayMs === 1,
      ),
      'Expected ref fill action to be recorded on the session',
    );
    assert.ok(
      actions.some(
        (action) =>
          action.command === 'fill' &&
          action.positionals.join(' ') === '42 84 Eight' &&
          action.flags.delayMs === 1,
      ),
      'Expected coordinate fill action to be recorded on the session',
    );

    const close = await daemon.callCommand('close', ['gnome-calculator']);
    assert.equal(close.statusCode, 200, JSON.stringify(close.json));
    assert.deepEqual(desktopCalls, [
      ['open', 'gnome-calculator'],
      ['close', 'gnome-calculator'],
    ]);
    assertFlatToolCall(semanticCalls, ['accessibility', 'frontmost-app']);
    assertFlatToolCall(semanticCalls, ['clipboard', 'write', 'linux otp 314159']);
    assertFlatToolCall(semanticCalls, ['clipboard', 'read']);
    assertFlatToolCall(semanticCalls, ['screenshot', screenshotPath]);
    const normalizedToolCalls = normalizeToolCalls(toolCalls);
    assertToolCall(normalizedToolCalls, ['xdotool', 'click', '1']);
    assertToolCall(normalizedToolCalls, [
      'xdotool',
      'type',
      '--delay',
      '1',
      '--clearmodifiers',
      '--',
      'Seven',
    ]);
    assertToolCall(normalizedToolCalls, [
      'xdotool',
      'type',
      '--delay',
      '1',
      '--clearmodifiers',
      '--',
      'Eight',
    ]);
    assertToolCall(normalizedToolCalls, ['xdotool', 'type', '--clearmodifiers', '--', '5']);
    assertToolCall(normalizedToolCalls, ['xdotool', 'key', '--clearmodifiers', 'alt+Left']);
    assertToolCall(normalizedToolCalls, ['xdotool', 'key', '--clearmodifiers', 'super+d']);
    assert.ok(
      normalizedToolCalls.some(
        ([cmd, args]) => cmd === 'xdotool' && args[0] === 'click' && args.includes('3'),
      ),
      'Expected secondary click to reach xdotool',
    );
    assert.ok(
      normalizedToolCalls.some(
        ([cmd, args]) => cmd === 'xdotool' && args[0] === 'click' && args.includes('2'),
      ),
      'Expected middle click to reach xdotool',
    );
    assert.ok(
      normalizedToolCalls.some(
        ([cmd, args]) => cmd === 'xdotool' && args[0] === 'click' && args.includes('--repeat'),
      ),
      'Expected repeated click based gestures to reach xdotool',
    );
    assert.ok(
      normalizedToolCalls.some(([cmd, args]) => cmd === 'xdotool' && args[0] === 'mousedown'),
      'Expected drag/long-press gestures to press the pointer button',
    );
    assert.ok(
      normalizedToolCalls.some(([cmd, args]) => cmd === 'xdotool' && args[0] === 'mouseup'),
      'Expected drag/long-press gestures to release the pointer button',
    );
  } finally {
    await daemon.close();
    fs.rmSync(screenshotPath, { force: true });
    Object.defineProperty(process, 'platform', { value: previousPlatform, configurable: true });
    restoreEnv('XDG_SESSION_TYPE', previousSessionType);
    restoreEnv('WAYLAND_DISPLAY', previousWaylandDisplay);
    restoreEnv('AGENT_DEVICE_HTTP_AUTH_HOOK', previousAuthHook);
  }
});

function linuxCalculatorSnapshotNodes(): Array<{
  index: number;
  role: string;
  label: string;
  rect: { x: number; y: number; width: number; height: number };
  enabled: boolean;
  hittable: boolean;
  depth: number;
  parentIndex?: number;
}> {
  return [
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
    {
      index: 2,
      role: 'push button',
      label: 'Clear',
      rect: { x: 90, y: 80, width: 70, height: 40 },
      enabled: true,
      hittable: true,
      depth: 1,
      parentIndex: 0,
    },
  ];
}

function normalizeToolCalls(calls: Array<[string, string[]]>): Array<[string, string[]]> {
  return calls.map(([cmd, args]) => [
    cmd,
    cmd === 'python3' && args[0] ? [args[0].split('/').at(-1) ?? args[0], ...args.slice(1)] : args,
  ]);
}
