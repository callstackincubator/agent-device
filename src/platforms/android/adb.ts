import { whichCmd } from '../../utils/exec.ts';
import { AppError } from '../../utils/errors.ts';
import type { DeviceInfo } from '../../utils/device.ts';

export function adbArgs(device: DeviceInfo, args: string[]): string[] {
  return ['-s', device.id, ...args];
}

export async function ensureAdb(): Promise<void> {
  const adbAvailable = await whichCmd('adb');
  if (!adbAvailable) throw new AppError('TOOL_MISSING', 'adb not found in PATH');
}

export function isClipboardShellUnsupported(stdout: string, stderr: string): boolean {
  const haystack = `${stdout}\n${stderr}`.toLowerCase();
  return (
    haystack.includes('no shell command implementation') || haystack.includes('unknown command')
  );
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
