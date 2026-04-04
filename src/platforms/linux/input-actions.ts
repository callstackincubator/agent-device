import { runCmd, whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { ScrollDirection } from '../../core/scroll-gesture.ts';

// ── Display server detection ────────────────────────────────────────────

type DisplayServer = 'wayland' | 'x11';

function detectDisplayServer(): DisplayServer {
  if (process.env['WAYLAND_DISPLAY']) return 'wayland';
  if (process.env['XDG_SESSION_TYPE'] === 'wayland') return 'wayland';
  return 'x11';
}

// ── xdotool / ydotool helpers ───────────────────────────────────────────

async function ensureInputTool(): Promise<{ tool: 'xdotool' | 'ydotool'; display: DisplayServer }> {
  const display = detectDisplayServer();

  if (display === 'wayland') {
    if (await whichCmd('ydotool')) return { tool: 'ydotool', display };
    if (await whichCmd('xdotool')) return { tool: 'xdotool', display };
    throw new AppError(
      'TOOL_MISSING',
      'ydotool (or xdotool) is required for input synthesis on Wayland. Install it via your package manager.',
    );
  }

  if (await whichCmd('xdotool')) return { tool: 'xdotool', display };
  throw new AppError(
    'TOOL_MISSING',
    'xdotool is required for input synthesis on X11. Install it via your package manager.',
  );
}

async function xdotool(...args: string[]): Promise<void> {
  await runCmd('xdotool', args, { allowFailure: false });
}

async function ydotool(...args: string[]): Promise<void> {
  await runCmd('ydotool', args, { allowFailure: false });
}

// ── Mouse actions ───────────────────────────────────────────────────────

export async function pressLinux(x: number, y: number): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('click', '1');
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x), '-y', String(y));
    await ydotool('click', '0xC0');
  }
}

export async function rightClickLinux(x: number, y: number): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('click', '3');
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x), '-y', String(y));
    await ydotool('click', '0xC1');
  }
}

export async function middleClickLinux(x: number, y: number): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('click', '2');
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x), '-y', String(y));
    await ydotool('click', '0xC2');
  }
}

export async function doubleClickLinux(x: number, y: number): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('click', '--repeat', '2', '1');
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x), '-y', String(y));
    await ydotool('click', '0xC0');
    await ydotool('click', '0xC0');
  }
}

export async function longPressLinux(
  x: number,
  y: number,
  durationMs = 800,
): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x), String(y));
    await xdotool('mousedown', '1');
    await sleep(durationMs);
    await xdotool('mouseup', '1');
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x), '-y', String(y));
    await ydotool('mousedown', '1');
    await sleep(durationMs);
    await ydotool('mouseup', '1');
  }
}

export async function focusLinux(x: number, y: number): Promise<void> {
  await pressLinux(x, y);
}

// ── Swipe / scroll ──────────────────────────────────────────────────────

export async function swipeLinux(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 300,
): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x1), String(y1));
    await xdotool('mousedown', '1');
    // xdotool doesn't support duration for mousemove, so we do a direct move
    await xdotool('mousemove', '--sync', String(x2), String(y2));
    await sleep(durationMs);
    await xdotool('mouseup', '1');
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x1), '-y', String(y1));
    await ydotool('mousedown', '1');
    await ydotool('mousemove', '--absolute', '-x', String(x2), '-y', String(y2));
    await sleep(durationMs);
    await ydotool('mouseup', '1');
  }
}

export async function scrollLinux(
  direction: ScrollDirection,
  _options?: { amount?: number; pixels?: number },
): Promise<void> {
  const { tool } = await ensureInputTool();
  // xdotool: button 4=up, 5=down, 6=left, 7=right
  // ydotool: wheel events use positive/negative values
  const scrollCount = 5; // number of scroll increments

  if (tool === 'xdotool') {
    const button = direction === 'up' ? '4' : direction === 'down' ? '5' : direction === 'left' ? '6' : '7';
    await xdotool('click', '--repeat', String(scrollCount), button);
  } else {
    if (direction === 'up' || direction === 'down') {
      const value = direction === 'up' ? '-3' : '3';
      await ydotool('mousemove', '--wheel', '-y', value);
    } else {
      const value = direction === 'left' ? '-3' : '3';
      await ydotool('mousemove', '--wheel', '-x', value);
    }
  }
}

// ── Keyboard actions ────────────────────────────────────────────────────

export async function typeLinux(text: string, delayMs = 0): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    const args = ['type'];
    if (delayMs > 0) args.push('--delay', String(delayMs));
    args.push('--clearmodifiers', '--', text);
    await xdotool(...args);
  } else {
    await ydotool('type', '--', text);
  }
}

export async function fillLinux(
  x: number,
  y: number,
  text: string,
  delayMs = 0,
): Promise<void> {
  // Click to focus the field
  await pressLinux(x, y);
  await sleep(100);
  // Select all existing text
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('key', '--clearmodifiers', 'ctrl+a');
  } else {
    await ydotool('key', '29:1', '30:1', '30:0', '29:0'); // Ctrl+A via scancodes
  }
  await sleep(50);
  // Type replacement text
  await typeLinux(text, delayMs);
}

// ── Utilities ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
