import { asAppError } from '../utils/errors.ts';

export type BootFailureReason =
  | 'BOOT_TIMEOUT'
  | 'DEVICE_UNAVAILABLE'
  | 'DEVICE_OFFLINE'
  | 'PERMISSION_DENIED'
  | 'TOOL_MISSING'
  | 'BOOT_COMMAND_FAILED'
  | 'UNKNOWN';

export function classifyBootFailure(input: {
  error?: unknown;
  message?: string;
  stdout?: string;
  stderr?: string;
}): BootFailureReason {
  const appErr = input.error ? asAppError(input.error) : null;
  if (appErr?.code === 'TOOL_MISSING') return 'TOOL_MISSING';
  const details = (appErr?.details ?? {}) as Record<string, unknown>;
  const detailMessage = typeof details.message === 'string' ? details.message : undefined;
  const detailStdout = typeof details.stdout === 'string' ? details.stdout : undefined;
  const detailStderr = typeof details.stderr === 'string' ? details.stderr : undefined;
  const nestedBoot = details.boot && typeof details.boot === 'object'
    ? (details.boot as Record<string, unknown>)
    : null;
  const nestedBootstatus = details.bootstatus && typeof details.bootstatus === 'object'
    ? (details.bootstatus as Record<string, unknown>)
    : null;

  const haystack = [
    input.message,
    appErr?.message,
    input.stdout,
    input.stderr,
    detailMessage,
    detailStdout,
    detailStderr,
    typeof nestedBoot?.stdout === 'string' ? nestedBoot.stdout : undefined,
    typeof nestedBoot?.stderr === 'string' ? nestedBoot.stderr : undefined,
    typeof nestedBootstatus?.stdout === 'string' ? nestedBootstatus.stdout : undefined,
    typeof nestedBootstatus?.stderr === 'string' ? nestedBootstatus.stderr : undefined,
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  if (haystack.includes('timed out') || haystack.includes('timeout')) return 'BOOT_TIMEOUT';
  if (
    haystack.includes('device not found') ||
    haystack.includes('no devices') ||
    haystack.includes('unable to locate device') ||
    haystack.includes('invalid device')
  ) {
    return 'DEVICE_UNAVAILABLE';
  }
  if (haystack.includes('offline')) return 'DEVICE_OFFLINE';
  if (
    haystack.includes('permission denied') ||
    haystack.includes('not authorized') ||
    haystack.includes('unauthorized')
  ) {
    return 'PERMISSION_DENIED';
  }
  if (appErr?.code === 'COMMAND_FAILED' || haystack.length > 0) return 'BOOT_COMMAND_FAILED';
  return 'UNKNOWN';
}
