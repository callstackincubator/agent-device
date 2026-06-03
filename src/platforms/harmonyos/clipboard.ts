import type { DeviceInfo } from '../../utils/device.ts';
import { AppError } from '../../utils/errors.ts';
import { runHarmonyHdc } from './hdc.ts';

/**
 * Read clipboard text from HarmonyOS device.
 * HarmonyOS doesn't have a direct hdc clipboard command.
 * This implementation tries multiple approaches.
 */
export async function readHarmonyClipboardText(device: DeviceInfo): Promise<string> {
  // Try using uitest clipboard API
  const result = await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'getClipboard'], {
    allowFailure: true,
    timeoutMs: 10_000,
  });

  if (result.exitCode === 0 && result.stdout.trim()) {
    return result.stdout.trim();
  }

  // Fallback: return empty string (clipboard access requires app-level implementation)
  return '';
}

/**
 * Write text to HarmonyOS device clipboard.
 * HarmonyOS doesn't have a direct hdc clipboard command.
 * This implementation tries uitest clipboard API.
 */
export async function writeHarmonyClipboardText(device: DeviceInfo, text: string): Promise<void> {
  // Try using uitest clipboard API
  const result = await runHarmonyHdc(device, ['shell', 'uitest', 'uiInput', 'setClipboard', text], {
    allowFailure: true,
    timeoutMs: 10_000,
  });

  if (result.exitCode !== 0) {
    // Clipboard operations may require specific permissions or app context
    throw new AppError(
      'COMMAND_FAILED',
      `Failed to write to HarmonyOS clipboard. Clipboard operations may require app-level implementation.`,
      {
        stderr: result.stderr,
        text: text.slice(0, 100),
      },
    );
  }
}
