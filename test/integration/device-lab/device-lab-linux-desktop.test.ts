import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { listLinuxDevices } from '../../../src/platforms/linux/devices.ts';
import { createLocalLinuxToolProvider } from '../../../src/platforms/linux/tool-provider.ts';
import { assertFlatToolCall, assertPngFile, validPng } from './assertions.ts';
import { DEVICE_LAB_LINUX } from './fixtures.ts';
import { restoreEnv, createDeviceLabHarness } from './harness.ts';
import { runDeviceLabScenario } from './scenario.ts';

test('Device Lab Linux desktop flow uses semantic desktop and input providers', async () => {
  const previousSessionType = process.env.XDG_SESSION_TYPE;
  const previousWaylandDisplay = process.env.WAYLAND_DISPLAY;
  const previousAuthHook = process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;
  const previousPlatform = process.platform;
  const screenshotPath = path.join(os.tmpdir(), `agent-device-lab-linux-${Date.now()}.png`);
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
  assert.deepEqual(await listLinuxDevices(), []);
  Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
  process.env.XDG_SESSION_TYPE = 'x11';
  delete process.env.WAYLAND_DISPLAY;
  delete process.env.AGENT_DEVICE_HTTP_AUTH_HOOK;

  const localLinuxDevices = await listLinuxDevices();
  assert.equal(localLinuxDevices[0]?.platform, 'linux');
  assert.equal(localLinuxDevices[0]?.target, 'desktop');

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
      capture: async (outPath, options) => {
        semanticCalls.push([
          'screenshot',
          outPath,
          String(options?.fullscreen ?? ''),
          String(options?.stabilize ?? ''),
          String(options?.surface ?? ''),
        ]);
        fs.writeFileSync(outPath, validPng());
      },
    },
    input: {
      click: async (x, y, button) => {
        semanticCalls.push(['input', 'click', String(x), String(y), button]);
      },
      doubleClick: async (x, y) => {
        semanticCalls.push(['input', 'double-click', String(x), String(y)]);
      },
      longPress: async (x, y, durationMs) => {
        semanticCalls.push(['input', 'long-press', String(x), String(y), String(durationMs)]);
      },
      drag: async (x1, y1, x2, y2, durationMs) => {
        semanticCalls.push([
          'input',
          'drag',
          String(x1),
          String(y1),
          String(x2),
          String(y2),
          String(durationMs),
        ]);
      },
      scroll: async (direction, options) => {
        semanticCalls.push([
          'input',
          'scroll',
          direction,
          String(options?.amount ?? ''),
          String(options?.pixels ?? ''),
        ]);
      },
      typeText: async (text, options) => {
        semanticCalls.push(['input', 'type', text, String(options?.delayMs ?? 0)]);
      },
      key: async (combo) => {
        semanticCalls.push(['input', 'key', combo]);
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
        name: 'read snapshot ref text through Linux accessibility',
        command: 'get',
        positionals: ['text', '@e2'],
        expectData: { text: '5' },
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
        flags: {
          screenshotFullscreen: true,
          screenshotNoStabilize: true,
        },
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
    assertFlatToolCall(semanticCalls, ['screenshot', screenshotPath, 'true', 'false', 'app']);
    assertFlatToolCall(semanticCalls, ['input', 'click', '60', '100', 'primary']);
    assertFlatToolCall(semanticCalls, ['input', 'click', '42', '84', 'primary']);
    assertFlatToolCall(semanticCalls, ['input', 'click', '42', '84', 'secondary']);
    assertFlatToolCall(semanticCalls, ['input', 'click', '42', '84', 'middle']);
    assertFlatToolCall(semanticCalls, ['input', 'double-click', '42', '84']);
    assertFlatToolCall(semanticCalls, ['input', 'long-press', '42', '84', '1']);
    assertFlatToolCall(semanticCalls, ['input', 'drag', '10', '20', '30', '40', '16']);
    assertFlatToolCall(semanticCalls, ['input', 'type', 'Seven', '1']);
    assertFlatToolCall(semanticCalls, ['input', 'type', 'Eight', '1']);
    assertFlatToolCall(semanticCalls, ['input', 'type', '5', '0']);
    assertFlatToolCall(semanticCalls, ['input', 'key', 'ctrl+a']);
    assertFlatToolCall(semanticCalls, ['input', 'key', 'alt+Left']);
    assertFlatToolCall(semanticCalls, ['input', 'key', 'super+d']);
    assertFlatToolCall(semanticCalls, ['input', 'scroll', 'down', '', '45']);
    assertFlatToolCall(semanticCalls, ['input', 'scroll', 'up', '', '']);
    assert.deepEqual(toolCalls, [], 'Expected Linux Device Lab input to stay semantic');
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
