import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { findBounds, parseBounds, readNodeAttributes } from './ui-hierarchy.ts';
import { dumpUiHierarchy } from './snapshot.ts';
import { adbArgs, isClipboardShellUnsupported, sleep } from './adb.ts';

export async function pressAndroid(device: DeviceInfo, x: number, y: number): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'tap', String(x), String(y)]));
}

export async function swipeAndroid(
  device: DeviceInfo,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  durationMs = 250,
): Promise<void> {
  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(x1),
      String(y1),
      String(x2),
      String(y2),
      String(durationMs),
    ]),
  );
}

export async function backAndroid(device: DeviceInfo): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '4']));
}

export async function homeAndroid(device: DeviceInfo): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '3']));
}

export async function appSwitcherAndroid(device: DeviceInfo): Promise<void> {
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '187']));
}

export async function longPressAndroid(
  device: DeviceInfo,
  x: number,
  y: number,
  durationMs = 800,
): Promise<void> {
  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(x),
      String(y),
      String(x),
      String(y),
      String(durationMs),
    ]),
  );
}

export async function typeAndroid(device: DeviceInfo, text: string): Promise<void> {
  const shouldInjectViaClipboard = shouldUseClipboardTextInjection(text);
  if (shouldInjectViaClipboard) {
    const clipboardResult = await typeAndroidViaClipboard(device, text);
    if (clipboardResult === 'ok') return;
  }
  try {
    const encoded = encodeAndroidInputText(text);
    await runCmd('adb', adbArgs(device, ['shell', 'input', 'text', encoded]));
  } catch (error) {
    if (shouldInjectViaClipboard && isAndroidInputTextUnsupported(error)) {
      throw new AppError(
        'COMMAND_FAILED',
        'Non-ASCII text input is not supported on this Android shell. Install an ADB keyboard IME or use ASCII input.',
        { textPreview: text.slice(0, 32) },
        error instanceof Error ? error : undefined,
      );
    }
    throw error;
  }
}

export async function focusAndroid(device: DeviceInfo, x: number, y: number): Promise<void> {
  await pressAndroid(device, x, y);
}

export async function fillAndroid(
  device: DeviceInfo,
  x: number,
  y: number,
  text: string,
): Promise<void> {
  const textCodePointLength = Array.from(text).length;
  const requiresClipboardInjection = shouldUseClipboardTextInjection(text);
  const attempts: Array<{
    strategy: 'input_text' | 'clipboard_paste' | 'chunked_input';
    clearPadding: number;
    minClear: number;
    maxClear: number;
  }> = [{ strategy: 'input_text', clearPadding: 12, minClear: 8, maxClear: 48 }];
  if (!requiresClipboardInjection) {
    attempts.push({ strategy: 'clipboard_paste', clearPadding: 12, minClear: 8, maxClear: 48 });
    attempts.push({ strategy: 'chunked_input', clearPadding: 24, minClear: 16, maxClear: 96 });
  }

  let lastActual: string | null = null;

  for (const attempt of attempts) {
    await focusAndroid(device, x, y);
    const clearCount = clampCount(
      textCodePointLength + attempt.clearPadding,
      attempt.minClear,
      attempt.maxClear,
    );
    await clearFocusedText(device, clearCount);
    if (attempt.strategy === 'input_text') {
      await typeAndroid(device, text);
    } else if (attempt.strategy === 'clipboard_paste') {
      const clipboardResult = await typeAndroidViaClipboard(device, text);
      if (clipboardResult !== 'ok') {
        continue;
      }
    } else {
      await typeAndroidChunked(device, text, 1, 15);
    }
    lastActual = await readInputValueAtPoint(device, x, y);
    if (lastActual === text) return;
  }

  throw new AppError('COMMAND_FAILED', 'Android fill verification failed', {
    expected: text,
    actual: lastActual ?? null,
  });
}

export async function scrollAndroid(
  device: DeviceInfo,
  direction: string,
  amount = 0.6,
): Promise<void> {
  const size = await getAndroidScreenSize(device);
  const { width, height } = size;
  const distanceX = Math.floor(width * amount);
  const distanceY = Math.floor(height * amount);

  const centerX = Math.floor(width / 2);
  const centerY = Math.floor(height / 2);

  let x1 = centerX;
  let y1 = centerY;
  let x2 = centerX;
  let y2 = centerY;

  switch (direction) {
    case 'up':
      // Content moves up -> swipe down.
      y1 = centerY - Math.floor(distanceY / 2);
      y2 = centerY + Math.floor(distanceY / 2);
      break;
    case 'down':
      // Content moves down -> swipe up.
      y1 = centerY + Math.floor(distanceY / 2);
      y2 = centerY - Math.floor(distanceY / 2);
      break;
    case 'left':
      // Content moves left -> swipe right.
      x1 = centerX - Math.floor(distanceX / 2);
      x2 = centerX + Math.floor(distanceX / 2);
      break;
    case 'right':
      // Content moves right -> swipe left.
      x1 = centerX + Math.floor(distanceX / 2);
      x2 = centerX - Math.floor(distanceX / 2);
      break;
    default:
      throw new AppError('INVALID_ARGS', `Unknown direction: ${direction}`);
  }

  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(x1),
      String(y1),
      String(x2),
      String(y2),
      '300',
    ]),
  );
}

export async function scrollIntoViewAndroid(device: DeviceInfo, text: string): Promise<void> {
  const maxAttempts = 8;
  for (let i = 0; i < maxAttempts; i += 1) {
    let xml = '';
    try {
      xml = await dumpUiHierarchy(device);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new AppError('UNSUPPORTED_OPERATION', `uiautomator dump failed: ${message}`);
    }
    if (findBounds(xml, text)) return;
    await scrollAndroid(device, 'down', 0.5);
  }
  throw new AppError(
    'COMMAND_FAILED',
    `Could not find element containing "${text}" after scrolling`,
  );
}

export async function getAndroidScreenSize(
  device: DeviceInfo,
): Promise<{ width: number; height: number }> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'wm', 'size']));
  const match = result.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
  if (!match) throw new AppError('COMMAND_FAILED', 'Unable to read screen size');
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function typeAndroidChunked(
  device: DeviceInfo,
  text: string,
  chunkSize: number,
  delayMs: number,
): Promise<void> {
  const size = Math.max(1, Math.floor(chunkSize));
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += size) {
    const chunk = chars.slice(i, i + size).join('');
    await typeAndroid(device, chunk);
    if (delayMs > 0 && i + size < chars.length) {
      await sleep(delayMs);
    }
  }
}

function shouldUseClipboardTextInjection(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0);
    if (code === undefined) continue;
    if (code < 0x20 || code > 0x7e) return true;
  }
  return false;
}

function encodeAndroidInputText(text: string): string {
  // Android shell input uses `%s` as the escaped token for spaces.
  return text.replace(/ /g, '%s');
}

async function typeAndroidViaClipboard(
  device: DeviceInfo,
  text: string,
): Promise<'ok' | 'unsupported' | 'failed'> {
  const setClipboard = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'cmd', 'clipboard', 'set', 'text', text]),
    { allowFailure: true },
  );
  if (setClipboard.exitCode !== 0) return 'failed';
  if (isClipboardShellUnsupported(setClipboard.stdout, setClipboard.stderr)) return 'unsupported';

  const pasteByName = await runCmd(
    'adb',
    adbArgs(device, ['shell', 'input', 'keyevent', 'KEYCODE_PASTE']),
    { allowFailure: true },
  );
  if (pasteByName.exitCode === 0) return 'ok';

  const pasteByCode = await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', '279']), {
    allowFailure: true,
  });
  return pasteByCode.exitCode === 0 ? 'ok' : 'failed';
}

function isAndroidInputTextUnsupported(error: unknown): boolean {
  if (!(error instanceof AppError)) return false;
  if (error.code !== 'COMMAND_FAILED') return false;
  const stderr = String((error.details as any)?.stderr ?? '').toLowerCase();
  if (stderr.includes("exception occurred while executing 'text'")) return true;
  if (stderr.includes('nullpointerexception') && stderr.includes('inputshellcommand.sendtext'))
    return true;
  return false;
}

async function clearFocusedText(device: DeviceInfo, count: number): Promise<void> {
  const deletes = Math.max(0, count);
  await runCmd('adb', adbArgs(device, ['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']), {
    allowFailure: true,
  });
  const batchSize = 24;
  for (let i = 0; i < deletes; i += batchSize) {
    const size = Math.min(batchSize, deletes - i);
    await runCmd(
      'adb',
      adbArgs(device, ['shell', 'input', 'keyevent', ...Array(size).fill('KEYCODE_DEL')]),
      {
        allowFailure: true,
      },
    );
  }
}

async function readInputValueAtPoint(
  device: DeviceInfo,
  x: number,
  y: number,
): Promise<string | null> {
  const xml = await dumpUiHierarchy(device);
  const nodeRegex = /<node\b[^>]*>/g;
  let match: RegExpExecArray | null;
  let focusedEdit: { text: string; area: number } | null = null;
  let editAtPoint: { text: string; area: number } | null = null;
  let anyAtPoint: { text: string; area: number } | null = null;

  while ((match = nodeRegex.exec(xml)) !== null) {
    const node = match[0];
    const attrs = readNodeAttributes(node);
    const rect = parseBounds(attrs.bounds);
    if (!rect) continue;
    const className = attrs.className ?? '';
    const text = decodeXmlEntities(attrs.text ?? '');
    const focused = attrs.focused ?? false;
    if (!text) continue;
    const area = Math.max(1, rect.width * rect.height);
    const containsPoint =
      x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

    if (focused && isEditTextClass(className)) {
      if (!focusedEdit || area <= focusedEdit.area) {
        focusedEdit = { text, area };
      }
      continue;
    }
    if (containsPoint && isEditTextClass(className)) {
      if (!editAtPoint || area <= editAtPoint.area) {
        editAtPoint = { text, area };
      }
      continue;
    }
    if (containsPoint) {
      if (!anyAtPoint || area <= anyAtPoint.area) {
        anyAtPoint = { text, area };
      }
    }
  }

  return focusedEdit?.text ?? editAtPoint?.text ?? anyAtPoint?.text ?? null;
}

function isEditTextClass(className: string): boolean {
  const lower = className.toLowerCase();
  return lower.includes('edittext') || lower.includes('textfield');
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function clampCount(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
