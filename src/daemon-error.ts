import { AppError } from './utils/errors.ts';
import type { DaemonError } from './contracts.ts';

export function throwDaemonError(error: DaemonError): never {
  throw new AppError(error.code as any, error.message, {
    ...(error.details ?? {}),
    hint: error.hint,
    diagnosticId: error.diagnosticId,
    logPath: error.logPath,
  });
}
