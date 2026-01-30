export type ErrorCode =
  | 'INVALID_ARGS'
  | 'DEVICE_NOT_FOUND'
  | 'TOOL_MISSING'
  | 'APP_NOT_INSTALLED'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_OPERATION'
  | 'COMMAND_FAILED'
  | 'UNKNOWN';

export class AppError extends Error {
  code: ErrorCode;
  details?: Record<string, unknown>;
  cause?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super(message);
    this.code = code;
    this.details = details;
    this.cause = cause;
  }
}

export function asAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new AppError('UNKNOWN', err.message, undefined, err);
  }
  return new AppError('UNKNOWN', 'Unknown error', { err });
}
