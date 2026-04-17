import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import type { DeviceRotation } from '../../core/device-rotation.ts';
import { buildScrollGesturePlan, type ScrollDirection } from '../../core/scroll-gesture.ts';
import { parseBounds, readNodeAttributes } from './ui-hierarchy.ts';
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

export async function rotateAndroid(
  device: DeviceInfo,
  orientation: DeviceRotation,
): Promise<void> {
  const userRotation = resolveAndroidUserRotation(orientation);
  await runCmd(
    'adb',
    adbArgs(device, ['shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0']),
  );
  await runCmd(
    'adb',
    adbArgs(device, ['shell', 'settings', 'put', 'system', 'user_rotation', userRotation]),
  );
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

export async function typeAndroid(device: DeviceInfo, text: string, delayMs = 0): Promise<void> {
  if (delayMs > 0 && Array.from(text).length > 1) {
    await typeAndroidChunked(device, text, 1, delayMs);
    return;
  }
  await typeAndroidImmediate(device, text);
}

async function typeAndroidImmediate(device: DeviceInfo, text: string): Promise<void> {
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
  delayMs = 0,
): Promise<void> {
  const textCodePointLength = Array.from(text).length;
  const requiresClipboardInjection = shouldUseClipboardTextInjection(text);
  const attempts: Array<{
    strategy: 'input_text' | 'clipboard_paste' | 'chunked_input';
    clearPadding: number;
    minClear: number;
    maxClear: number;
  }> = [{ strategy: 'input_text', clearPadding: 12, minClear: 8, maxClear: 48 }];
  if (!requiresClipboardInjection && delayMs <= 0) {
    attempts.push({ strategy: 'clipboard_paste', clearPadding: 12, minClear: 8, maxClear: 48 });
  }
  if (!requiresClipboardInjection || delayMs > 0) {
    // Delayed typing must keep chunked input available, even for text that otherwise requires clipboard injection.
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
      await typeAndroid(device, text, delayMs);
    } else if (attempt.strategy === 'clipboard_paste') {
      const clipboardResult = await typeAndroidViaClipboard(device, text);
      if (clipboardResult !== 'ok') {
        continue;
      }
    } else {
      await typeAndroidChunked(device, text, 1, delayMs > 0 ? delayMs : 15);
    }
    const verification = await verifyAndroidFilledText(device, x, y, text);
    lastActual = verification.actual;
    if (verification.ok) return;
  }

  throw new AppError('COMMAND_FAILED', 'Android fill verification failed', {
    expected: text,
    actual: lastActual ?? null,
  });
}

async function verifyAndroidFilledText(
  device: DeviceInfo,
  x: number,
  y: number,
  expected: string,
): Promise<{ ok: boolean; actual: string | null }> {
  const verificationDelaysMs = [0, 150, 350];
  let lastActual: string | null = null;

  for (const delayMs of verificationDelaysMs) {
    if (delayMs > 0) {
      await sleep(delayMs);
    }
    lastActual = await readAndroidTextAtPoint(device, x, y);
    if (isAcceptableAndroidFillMatch(lastActual, expected)) {
      return { ok: true, actual: lastActual };
    }
  }

  return { ok: false, actual: lastActual };
}

function isAcceptableAndroidFillMatch(actual: string | null, expected: string): boolean {
  if (actual === expected) {
    return true;
  }
  const normalizedActual = normalizeFillVerificationText(actual);
  const normalizedExpected = normalizeFillVerificationText(expected);
  if (!normalizedActual || !normalizedExpected) {
    return false;
  }
  if (normalizedActual === normalizedExpected) {
    return true;
  }
  if (normalizedActual.includes(normalizedExpected)) {
    return true;
  }
  return (
    normalizedExpected.includes(normalizedActual) &&
    normalizedActual.length >= Math.max(4, Math.floor(normalizedExpected.length * 0.8))
  );
}

function normalizeFillVerificationText(value: string | null): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

export async function scrollAndroid(
  device: DeviceInfo,
  direction: ScrollDirection,
  options?: { amount?: number; pixels?: number },
): Promise<Record<string, unknown>> {
  const size = await getAndroidScreenSize(device);
  const plan = buildScrollGesturePlan({
    direction,
    amount: options?.amount,
    pixels: options?.pixels,
    referenceWidth: size.width,
    referenceHeight: size.height,
  });

  await runCmd(
    'adb',
    adbArgs(device, [
      'shell',
      'input',
      'swipe',
      String(plan.x1),
      String(plan.y1),
      String(plan.x2),
      String(plan.y2),
      '300',
    ]),
  );

  return plan;
}

function resolveAndroidUserRotation(orientation: DeviceRotation): string {
  switch (orientation) {
    case 'portrait':
      return '0';
    case 'landscape-left':
      return '1';
    case 'portrait-upside-down':
      return '2';
    case 'landscape-right':
      return '3';
    default:
      throw new AppError('INVALID_ARGS', `Unsupported Android rotation: ${orientation}`);
  }
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
    await typeAndroidImmediate(device, chunk);
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
  const rawStderr = error.details?.stderr;
  const stderr = (typeof rawStderr === 'string' ? rawStderr : '').toLowerCase();
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

export async function readAndroidTextAtPoint(
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
