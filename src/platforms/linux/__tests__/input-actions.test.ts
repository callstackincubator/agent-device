import { afterAll, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';

vi.mock('../../../utils/exec.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/exec.ts')>();
  return { ...actual, runCmd: vi.fn(), whichCmd: vi.fn() };
});

import { runCmd, whichCmd } from '../../../utils/exec.ts';
import { resetInputToolCache } from '../linux-env.ts';
import {
  pressLinux,
  rightClickLinux,
  middleClickLinux,
  doubleClickLinux,
  focusLinux,
  swipeLinux,
  scrollLinux,
  typeLinux,
  fillLinux,
  sendKey,
} from '../input-actions.ts';

const mockRunCmd = vi.mocked(runCmd);
const mockWhichCmd = vi.mocked(whichCmd);

const originalPlatform = process.platform;
const originalEnv = { ...process.env };

function setupXdotool(): void {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  process.env['XDG_SESSION_TYPE'] = 'x11';
  delete process.env['WAYLAND_DISPLAY'];
  resetInputToolCache();
  mockWhichCmd.mockImplementation(async (cmd) => cmd === 'xdotool');
  mockRunCmd.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
}

function setupYdotool(): void {
  Object.defineProperty(process, 'platform', { value: 'linux' });
  process.env['XDG_SESSION_TYPE'] = 'wayland';
  process.env['WAYLAND_DISPLAY'] = 'wayland-0';
  resetInputToolCache();
  mockWhichCmd.mockImplementation(async (cmd) => cmd === 'ydotool');
  mockRunCmd.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
}

/** Extract the [command, args] pairs from all runCmd calls. */
function calls(): Array<[string, string[]]> {
  return mockRunCmd.mock.calls.map((c) => [c[0], c[1] as string[]]);
}

beforeEach(() => {
  mockRunCmd.mockReset();
  mockWhichCmd.mockReset();
  resetInputToolCache();
});

afterAll(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  Object.assign(process.env, originalEnv);
});

// ── xdotool tests ────────────────────────────────────────────────────────

test('pressLinux uses xdotool mousemove + click on X11', async () => {
  setupXdotool();
  await pressLinux(100, 200);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('mousemove') && args.includes('100') && args.includes('200')));
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('1')));
});

test('rightClickLinux sends button 3 via xdotool', async () => {
  setupXdotool();
  await rightClickLinux(50, 60);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('3')));
});

test('middleClickLinux sends button 2 via xdotool', async () => {
  setupXdotool();
  await middleClickLinux(50, 60);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('2')));
});

test('doubleClickLinux sends --repeat 2 via xdotool', async () => {
  setupXdotool();
  await doubleClickLinux(10, 20);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('--repeat') && args.includes('2')));
});

test('sendKey uses xdotool key with combo', async () => {
  setupXdotool();
  await sendKey('alt+Left', ['56:1', '105:1', '105:0', '56:0']);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('key') && args.includes('alt+Left')));
});

test('typeLinux uses xdotool type with delay', async () => {
  setupXdotool();
  await typeLinux('hello', 50);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('type') && args.includes('--delay') && args.includes('50') && args.includes('hello')));
});

test('typeLinux omits --delay when delayMs is 0', async () => {
  setupXdotool();
  await typeLinux('test', 0);
  const c = calls();
  const typeCall = c.find(([cmd, args]) => cmd === 'xdotool' && args.includes('type'));
  assert.ok(typeCall);
  assert.ok(!typeCall[1].includes('--delay'));
});

test('scrollLinux uses xdotool button 4 for up, 5 for down', async () => {
  setupXdotool();
  await scrollLinux('up');
  let c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('4')));

  mockRunCmd.mockClear();
  resetInputToolCache();
  setupXdotool();
  await scrollLinux('down');
  c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('5')));
});

test('scrollLinux converts pixels to click count', async () => {
  setupXdotool();
  await scrollLinux('down', { pixels: 150 });
  const c = calls();
  // 150 / 15 = 10 clicks
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('--repeat') && args.includes('10')));
});

test('swipeLinux performs mousedown, mousemove, mouseup via xdotool', async () => {
  setupXdotool();
  await swipeLinux(0, 0, 100, 100, 10);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('mousedown')));
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('mousemove') && args.includes('100')));
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('mouseup')));
});

test('focusLinux delegates to pressLinux', async () => {
  setupXdotool();
  await focusLinux(30, 40);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('mousemove') && args.includes('30') && args.includes('40')));
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('1')));
});

// ── ydotool tests ────────────────────────────────────────────────────────

test('pressLinux uses ydotool mousemove + click on Wayland', async () => {
  setupYdotool();
  await pressLinux(100, 200);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'ydotool' && args.includes('mousemove') && args.includes('--absolute')));
  assert.ok(c.some(([cmd, args]) => cmd === 'ydotool' && args.includes('click') && args.includes('0xC0')));
});

test('sendKey uses ydotool with scancodes', async () => {
  setupYdotool();
  await sendKey('alt+Left', ['56:1', '105:1', '105:0', '56:0']);
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'ydotool' && args.includes('key') && args.includes('56:1')));
});

test('typeLinux uses ydotool type', async () => {
  setupYdotool();
  await typeLinux('hello');
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'ydotool' && args.includes('type') && args.includes('hello')));
});

test('scrollLinux uses ydotool mousemove --wheel for vertical scroll', async () => {
  setupYdotool();
  await scrollLinux('up');
  const c = calls();
  assert.ok(c.some(([cmd, args]) => cmd === 'ydotool' && args.includes('mousemove') && args.includes('--wheel') && args.includes('-y')));
});

// ── fillLinux tests ──────────────────────────────────────────────────────

test('fillLinux clicks, selects all, then types on X11', async () => {
  setupXdotool();
  await fillLinux(50, 50, 'new text', 0);
  const c = calls();
  // Should click, then ctrl+a, then type
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('click') && args.includes('1')));
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('key') && args.includes('ctrl+a')));
  assert.ok(c.some(([cmd, args]) => cmd === 'xdotool' && args.includes('type') && args.includes('new text')));
});
