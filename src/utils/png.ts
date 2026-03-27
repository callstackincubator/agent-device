import { PNG } from 'pngjs';
import { AppError } from './errors.ts';

export function decodePng(buffer: Buffer, label: string): PNG {
  try {
    return PNG.sync.read(buffer);
  } catch (error) {
    throw new AppError('COMMAND_FAILED', `Failed to decode ${label} as PNG`, {
      label,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}
