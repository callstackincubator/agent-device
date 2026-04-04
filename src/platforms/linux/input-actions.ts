import { runCmd } from '../../utils/exec.ts';
import { ensureInputTool } from './linux-env.ts';
import type { ScrollDirection } from '../../core/scroll-gesture.ts';

// ── Low-level wrappers ─────────────────────────────────────────────────

async function xdotool(...args: string[]): Promise<void> {
  await runCmd('xdotool', args, { allowFailure: false });
}

async function ydotool(...args: string[]): Promise<void> {
  await runCmd('ydotool', args, { allowFailure: false });
}

/** Move the pointer to (x, y) using the detected input tool. */
async function moveTo(x: number, y: number): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('mousemove', '--sync', String(x), String(y));
  } else {
    await ydotool('mousemove', '--absolute', '-x', String(x), '-y', String(y));
  }
}

/** Send a key combination via the detected input tool. */
export async function sendKey(combo: string, scancodes?: string[]): Promise<void> {
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('key', '--clearmodifiers', combo);
  } else if (scancodes) {
    await ydotool('key', ...scancodes);
  }
}

// ── Mouse actions ───────────────────────────────────────────────────────

async function clickButton(x: number, y: number, xdoBtn: string, ydoCode: string): Promise<void> {
  await moveTo(x, y);
  const { tool } = await ensureInputTool();
  if (tool === 'xdotool') {
    await xdotool('click', xdoBtn);
  } else {
    await ydotool('click', ydoCode);
  }
}

export async function pressLinux(x: number, y: number): Promise<void> {
  await clickButton(x, y, '1', '0xC0');
}

export async function rightClickLinux(x: number, y: number): Promise<void> {
  await clickButton(x, y, '3', '0xC1');
}

export async function middleClickLinux(x: number, y: number): Promise<void> {
  await clickButton(x, y, '2', '0xC2');
}

export async function doubleClickLinux(x: number, y: number): Promise<void> {
  const { tool } = await ensureInputTool();
  await moveTo(x, y);
  if (tool === 'xdotool') {
    await xdotool('click', '--repeat', '2', '1');
  } else {
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
  await moveTo(x, y);
  if (tool === 'xdotool') {
    await xdotool('mousedown', '1');
    await sleep(durationMs);
    await xdotool('mouseup', '1');
  } else {
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
  await moveTo(x1, y1);
  if (tool === 'xdotool') {
    await xdotool('mousedown', '1');
    await xdotool('mousemove', '--sync', String(x2), String(y2));
    await sleep(durationMs);
    await xdotool('mouseup', '1');
  } else {
    await ydotool('mousedown', '1');
    await ydotool('mousemove', '--absolute', '-x', String(x2), '-y', String(y2));
    await sleep(durationMs);
    await ydotool('mouseup', '1');
  }
}

const DEFAULT_SCROLL_CLICKS = 5;

export async function scrollLinux(
  direction: ScrollDirection,
  options?: { amount?: number; pixels?: number },
): Promise<void> {
  const { tool } = await ensureInputTool();

  // Translate amount/pixels into a discrete click count.
  // xdotool button clicks scroll ~15px each (3 lines × 5px).
  // ydotool wheel units are ~40px each.
  let scrollCount = DEFAULT_SCROLL_CLICKS;
  if (options?.pixels != null) {
    scrollCount = tool === 'xdotool'
      ? Math.max(1, Math.round(options.pixels / 15))
      : Math.max(1, Math.round(options.pixels / 40));
  } else if (options?.amount != null) {
    // amount is a fraction (0–1+) of the viewport; scale relative to default
    scrollCount = Math.max(1, Math.round(DEFAULT_SCROLL_CLICKS * (options.amount / 0.6)));
  }

  // xdotool: button 4=up, 5=down, 6=left, 7=right
  if (tool === 'xdotool') {
    const button = direction === 'up' ? '4' : direction === 'down' ? '5' : direction === 'left' ? '6' : '7';
    await xdotool('click', '--repeat', String(scrollCount), button);
  } else {
    // ydotool: wheel events use positive/negative values
    if (direction === 'up' || direction === 'down') {
      const value = direction === 'up' ? String(-scrollCount) : String(scrollCount);
      await ydotool('mousemove', '--wheel', '-y', value);
    } else {
      const value = direction === 'left' ? String(-scrollCount) : String(scrollCount);
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
  // Select all existing text (Ctrl+A)
  await sendKey('ctrl+a', ['29:1', '30:1', '30:0', '29:0']);
  await sleep(50);
  // Type replacement text
  await typeLinux(text, delayMs);
}

// ── Utilities ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
