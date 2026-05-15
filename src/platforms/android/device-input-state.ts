import { emitDiagnostic } from '../../utils/diagnostics.ts';
import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { isClipboardShellUnsupported, sleep } from './adb.ts';
import { resolveAndroidAdbExecutor, type AndroidAdbExecutor } from './adb-executor.ts';
import {
  classifyAndroidInputOwner,
  isFallbackAndroidInputMethodPackage,
  isFallbackAndroidInputMethodResource,
  readAndroidActiveInputMethodPackage,
  type AndroidInputOwner,
} from './input-ownership.ts';

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
const ANDROID_KEYCODE_ESCAPE = '111';

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
  inputMethodPackage?: string;
  focusedPackage?: string;
  focusedResourceId?: string;
  inputOwner: AndroidInputOwner;
};

export type AndroidKeyboardDismissResult = AndroidKeyboardState & {
  attempts: number;
  wasVisible: boolean;
  dismissed: boolean;
};

export async function getAndroidKeyboardState(device: DeviceInfo): Promise<AndroidKeyboardState> {
  return await getAndroidKeyboardStatusWithAdb(resolveAndroidAdbExecutor(device));
}

export async function getAndroidKeyboardStatusWithAdb(
  adb: AndroidAdbExecutor,
): Promise<AndroidKeyboardState> {
  const result = await adb(['shell', 'dumpsys', 'input_method'], {
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

export async function dismissAndroidKeyboard(
  device: DeviceInfo,
): Promise<AndroidKeyboardDismissResult> {
  return await dismissAndroidKeyboardWithAdb(resolveAndroidAdbExecutor(device));
}

export async function dismissAndroidKeyboardWithAdb(
  adb: AndroidAdbExecutor,
): Promise<AndroidKeyboardDismissResult> {
  const initialState = await getAndroidKeyboardStatusWithAdb(adb);
  let state = initialState;
  let attempts = 0;

  while (state.visible && attempts < ANDROID_KEYBOARD_DISMISS_MAX_ATTEMPTS) {
    await adb(['shell', 'input', 'keyevent', ANDROID_KEYCODE_ESCAPE]);
    attempts += 1;
    await sleep(ANDROID_KEYBOARD_DISMISS_RETRY_DELAY_MS);
    state = await getAndroidKeyboardStatusWithAdb(adb);
  }

  if (initialState.visible && state.visible) {
    throw new AppError(
      'UNSUPPORTED_OPERATION',
      'Android keyboard dismiss is unavailable for the current IME without back navigation.',
      {
        attempts,
        inputType: state.inputType,
        type: state.type,
        inputMethodPackage: state.inputMethodPackage,
        focusedPackage: state.focusedPackage,
        focusedResourceId: state.focusedResourceId,
        inputOwner: state.inputOwner,
      },
    );
  }

  return {
    attempts,
    wasVisible: initialState.visible,
    dismissed: initialState.visible && !state.visible,
    visible: state.visible,
    inputType: state.inputType,
    type: state.type,
    inputMethodPackage: state.inputMethodPackage,
    focusedPackage: state.focusedPackage,
    focusedResourceId: state.focusedResourceId,
    inputOwner: state.inputOwner,
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
  const focusedPackage = parseLastDumpsysValue(stdout, /\bpackageName=([A-Za-z0-9_.]+)\b/g);
  const focusedResourceId = parseLastDumpsysValue(
    stdout,
    /\b(?:resourceId|resource-id)=([^\s,}]+)/g,
  );
  const inputMethodPackage = readAndroidActiveInputMethodPackage(stdout);
  const inputOwner = classifyAndroidInputOwner(
    focusedPackage,
    focusedResourceId,
    inputMethodPackage,
  );
  if (
    !inputMethodPackage &&
    (isFallbackAndroidInputMethodPackage(focusedPackage) ||
      isFallbackAndroidInputMethodResource(focusedResourceId))
  ) {
    emitDiagnostic({
      level: 'warn',
      phase: 'android_input_ownership_fallback',
      data: {
        focusedPackage,
        focusedResourceId,
      },
    });
  }

  return {
    visible,
    inputType,
    type: inputType ? classifyAndroidKeyboardType(inputType) : undefined,
    inputMethodPackage,
    focusedPackage,
    focusedResourceId,
    inputOwner,
  };
}

function parseLastDumpsysValue(stdout: string, pattern: RegExp): string | undefined {
  let value: string | undefined;
  for (const match of stdout.matchAll(pattern)) {
    value = match[1];
  }
  return value;
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
  return await readAndroidClipboardWithAdb(resolveAndroidAdbExecutor(device));
}

export async function readAndroidClipboardWithAdb(adb: AndroidAdbExecutor): Promise<string> {
  const stdout = await runAndroidClipboardShellCommand(
    adb,
    ['shell', 'cmd', 'clipboard', 'get', 'text'],
    'read',
  );
  return normalizeAndroidClipboardText(stdout);
}

export async function writeAndroidClipboardText(device: DeviceInfo, text: string): Promise<void> {
  await writeAndroidClipboardWithAdb(resolveAndroidAdbExecutor(device), text);
}

export async function writeAndroidClipboardWithAdb(
  adb: AndroidAdbExecutor,
  text: string,
): Promise<void> {
  await runAndroidClipboardShellCommand(
    adb,
    ['shell', 'cmd', 'clipboard', 'set', 'text', text],
    'write',
  );
}

async function runAndroidClipboardShellCommand(
  adb: AndroidAdbExecutor,
  args: string[],
  operation: 'read' | 'write',
): Promise<string> {
  const result = await adb(args, { allowFailure: true });
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
