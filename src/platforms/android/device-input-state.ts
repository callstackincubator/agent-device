import { runCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { backAndroid } from './input-actions.ts';
import { adbArgs, isClipboardShellUnsupported, sleep } from './adb.ts';

const ANDROID_INPUT_TYPE_CLASS_MASK = 0x0000000f;
const ANDROID_INPUT_TYPE_CLASS_TEXT = 0x00000001;
const ANDROID_INPUT_TYPE_CLASS_NUMBER = 0x00000002;
const ANDROID_INPUT_TYPE_CLASS_PHONE = 0x00000003;
const ANDROID_INPUT_TYPE_CLASS_DATETIME = 0x00000004;
const ANDROID_INPUT_TYPE_VARIATION_MASK = 0x00000ff0;
const ANDROID_TEXT_VARIATION_EMAIL_ADDRESS = 0x00000020;
const ANDROID_TEXT_VARIATION_WEB_EMAIL_ADDRESS = 0x000000d0;
const ANDROID_TEXT_VARIATION_PASSWORD = 0x00000080;
const ANDROID_TEXT_VARIATION_WEB_PASSWORD = 0x000000e0;
const ANDROID_TEXT_VARIATION_VISIBLE_PASSWORD = 0x00000090;
const ANDROID_KEYBOARD_DISMISS_MAX_ATTEMPTS = 2;
const ANDROID_KEYBOARD_DISMISS_RETRY_DELAY_MS = 120;

type AndroidKeyboardType =
  | 'text'
  | 'number'
  | 'email'
  | 'phone'
  | 'password'
  | 'datetime'
  | 'unknown';

export type AndroidKeyboardState = {
  visible: boolean;
  inputType?: string;
  type?: AndroidKeyboardType;
};

export async function getAndroidKeyboardState(device: DeviceInfo): Promise<AndroidKeyboardState> {
  const result = await runCmd('adb', adbArgs(device, ['shell', 'dumpsys', 'input_method']), {
    allowFailure: true,
  });
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', 'Failed to query Android keyboard state', {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
  return parseAndroidKeyboardState(result.stdout);
}

export async function dismissAndroidKeyboard(device: DeviceInfo): Promise<{
  attempts: number;
  wasVisible: boolean;
  dismissed: boolean;
  visible: boolean;
  inputType?: string;
  type?: AndroidKeyboardType;
}> {
  const initialState = await getAndroidKeyboardState(device);
  let state = initialState;
  let attempts = 0;

  while (state.visible && attempts < ANDROID_KEYBOARD_DISMISS_MAX_ATTEMPTS) {
    await backAndroid(device);
    attempts += 1;
    await sleep(ANDROID_KEYBOARD_DISMISS_RETRY_DELAY_MS);
    state = await getAndroidKeyboardState(device);
  }

  return {
    attempts,
    wasVisible: initialState.visible,
    dismissed: initialState.visible && !state.visible,
    visible: state.visible,
    inputType: state.inputType,
    type: state.type,
  };
}

function parseAndroidKeyboardState(stdout: string): AndroidKeyboardState {
  const visibility = parseAndroidKeyboardVisibility(stdout);
  let visible = visibility ?? false;
  if (visibility === null) {
    const imeWindowVisibility = stdout.match(/\bmImeWindowVis=0x([0-9a-fA-F]+)\b/);
    if (imeWindowVisibility?.[1]) {
      const flags = Number.parseInt(imeWindowVisibility[1], 16);
      if (!Number.isNaN(flags)) {
        visible = (flags & 0x1) !== 0;
      }
    }
  }

  const inputTypeMatches = Array.from(stdout.matchAll(/\binputType=0x([0-9a-fA-F]+)\b/gi));
  const lastInputType =
    inputTypeMatches.length > 0 ? inputTypeMatches[inputTypeMatches.length - 1]?.[1] : undefined;
  const inputType = lastInputType ? `0x${lastInputType.toLowerCase()}` : undefined;

  return {
    visible,
    inputType,
    type: inputType ? classifyAndroidKeyboardType(inputType) : undefined,
  };
}

function parseAndroidKeyboardVisibility(stdout: string): boolean | null {
  const latestByKey = new Map<string, boolean>();
  const pattern = /\b(mInputShown|mIsInputViewShown|isInputViewShown)=([a-zA-Z]+)\b/g;
  for (const match of stdout.matchAll(pattern)) {
    const key = match[1];
    const value = match[2]?.toLowerCase();
    if (!key || (value !== 'true' && value !== 'false')) continue;
    latestByKey.set(key, value === 'true');
  }
  if (latestByKey.size === 0) return null;
  for (const visible of latestByKey.values()) {
    if (visible) return true;
  }
  return false;
}

function classifyAndroidKeyboardType(inputType: string): AndroidKeyboardType {
  const parsed = Number.parseInt(inputType.replace(/^0x/i, ''), 16);
  if (Number.isNaN(parsed)) return 'unknown';
  const inputClass = parsed & ANDROID_INPUT_TYPE_CLASS_MASK;
  if (inputClass === ANDROID_INPUT_TYPE_CLASS_NUMBER) return 'number';
  if (inputClass === ANDROID_INPUT_TYPE_CLASS_PHONE) return 'phone';
  if (inputClass === ANDROID_INPUT_TYPE_CLASS_DATETIME) return 'datetime';
  if (inputClass !== ANDROID_INPUT_TYPE_CLASS_TEXT) return 'unknown';

  const variation = parsed & ANDROID_INPUT_TYPE_VARIATION_MASK;
  if (
    variation === ANDROID_TEXT_VARIATION_EMAIL_ADDRESS ||
    variation === ANDROID_TEXT_VARIATION_WEB_EMAIL_ADDRESS
  ) {
    return 'email';
  }
  if (
    variation === ANDROID_TEXT_VARIATION_PASSWORD ||
    variation === ANDROID_TEXT_VARIATION_WEB_PASSWORD ||
    variation === ANDROID_TEXT_VARIATION_VISIBLE_PASSWORD
  ) {
    return 'password';
  }
  return 'text';
}

export async function readAndroidClipboardText(device: DeviceInfo): Promise<string> {
  const stdout = await runAndroidClipboardShellCommand(
    device,
    ['shell', 'cmd', 'clipboard', 'get', 'text'],
    'read',
  );
  return normalizeAndroidClipboardText(stdout);
}

export async function writeAndroidClipboardText(device: DeviceInfo, text: string): Promise<void> {
  await runAndroidClipboardShellCommand(
    device,
    ['shell', 'cmd', 'clipboard', 'set', 'text', text],
    'write',
  );
}

async function runAndroidClipboardShellCommand(
  device: DeviceInfo,
  args: string[],
  operation: 'read' | 'write',
): Promise<string> {
  const result = await runCmd('adb', adbArgs(device, args), { allowFailure: true });
  if (isClipboardShellUnsupported(result.stdout, result.stderr)) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      `Android shell clipboard ${operation} is not supported on this device.`,
    );
  }
  if (result.exitCode !== 0) {
    throw new AppError('COMMAND_FAILED', `Failed to ${operation} Android clipboard text`, {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
  return result.stdout;
}

function normalizeAndroidClipboardText(stdout: string): string {
  const normalized = stdout.replace(/\r\n/g, '\n').replace(/\n$/, '');
  const prefixed = normalized.match(/^clipboard text:\s*(.*)$/i);
  if (prefixed) return prefixed[1] ?? '';
  if (normalized.trim().toLowerCase() === 'null') return '';
  return normalized;
}
