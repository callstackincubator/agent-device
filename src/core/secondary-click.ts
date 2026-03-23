import { AppError } from '../utils/errors.ts';

export function getSecondaryClickValidationError(options: {
  commandLabel: string;
  platform: string;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
}): AppError | null {
  if (options.commandLabel !== 'click') {
    return new AppError('INVALID_ARGS', '--secondary is supported only for click');
  }
  if (options.platform !== 'macos') {
    return new AppError('UNSUPPORTED_OPERATION', 'click --secondary is supported only on macOS');
  }
  if (
    typeof options.count === 'number' ||
    typeof options.intervalMs === 'number' ||
    typeof options.holdMs === 'number' ||
    typeof options.jitterPx === 'number' ||
    options.doubleTap === true
  ) {
    return new AppError(
      'INVALID_ARGS',
      'click --secondary does not support repeat or gesture modifier flags',
    );
  }
  return null;
}
