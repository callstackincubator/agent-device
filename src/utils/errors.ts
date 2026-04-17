import { redactDiagnosticData } from './redaction.ts';

export type AppErrorCode =
  | 'INVALID_ARGS'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_IN_USE'
  | 'TOOL_MISSING'
  | 'APP_NOT_INSTALLED'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_OPERATION'
  | 'NOT_IMPLEMENTED'
  | 'COMMAND_FAILED'
  | 'SESSION_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'UNKNOWN';

const APP_ERROR_CODES: readonly AppErrorCode[] = [
  'INVALID_ARGS',
  'DEVICE_NOT_FOUND',
  'DEVICE_IN_USE',
  'TOOL_MISSING',
  'APP_NOT_INSTALLED',
  'UNSUPPORTED_PLATFORM',
  'UNSUPPORTED_OPERATION',
  'NOT_IMPLEMENTED',
  'COMMAND_FAILED',
  'SESSION_NOT_FOUND',
  'UNAUTHORIZED',
  'UNKNOWN',
];

/**
 * Narrow a wire-level error code string into a known AppErrorCode.
 * Unrecognised codes are surfaced verbatim by preserving them on details,
 * while the typed channel falls back to the provided default.
 */
export function toAppErrorCode(
  code: string | undefined,
  fallback: AppErrorCode = 'COMMAND_FAILED',
): AppErrorCode {
  if (typeof code === 'string' && (APP_ERROR_CODES as readonly string[]).includes(code)) {
    return code as AppErrorCode;
  }
  return fallback;
}

type AppErrorDetails = Record<string, unknown> & {
  hint?: string;
  diagnosticId?: string;
  logPath?: string;
};

export type NormalizedError = {
  code: string;
  message: string;
  hint?: string;
  diagnosticId?: string;
  logPath?: string;
  details?: Record<string, unknown>;
};

export class AppError extends Error {
  code: AppErrorCode;
  details?: AppErrorDetails;
  cause?: unknown;

  constructor(code: AppErrorCode, message: string, details?: AppErrorDetails, cause?: unknown) {
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

export function isAgentDeviceError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function normalizeAgentDeviceError(
  err: unknown,
  context: { diagnosticId?: string; logPath?: string } = {},
): NormalizedError {
  return normalizeError(err, context);
}

export function normalizeError(
  err: unknown,
  context: { diagnosticId?: string; logPath?: string } = {},
): NormalizedError {
  const appErr = asAppError(err);
  const details = appErr.details ? redactDiagnosticData(appErr.details) : undefined;
  const detailHint = details && typeof details.hint === 'string' ? details.hint : undefined;
  const diagnosticId =
    (details && typeof details.diagnosticId === 'string' ? details.diagnosticId : undefined) ??
    context.diagnosticId;
  const logPath =
    (details && typeof details.logPath === 'string' ? details.logPath : undefined) ??
    context.logPath;
  const hint = detailHint ?? defaultHintForCode(appErr.code);
  const cleanDetails = stripDiagnosticMeta(details);
  const message = maybeEnrichCommandFailedMessage(appErr.code, appErr.message, details);

  return {
    code: appErr.code,
    message,
    hint,
    diagnosticId,
    logPath,
    details: cleanDetails,
  };
}

function maybeEnrichCommandFailedMessage(
  code: string,
  message: string,
  details: Record<string, unknown> | undefined,
): string {
  if (code !== 'COMMAND_FAILED') return message;
  if (details?.processExitError !== true) return message;
  const stderr = typeof details?.stderr === 'string' ? details.stderr : '';
  const excerpt = firstStderrLine(stderr);
  if (!excerpt) return message;
  return excerpt;
}

function firstStderrLine(stderr: string): string | null {
  const skipPatterns = [
    /^an error was encountered processing the command/i,
    /^underlying error\b/i,
    /^simulator device failed to complete the requested operation/i,
  ];

  for (const rawLine of stderr.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    if (skipPatterns.some((pattern) => pattern.test(line))) continue;
    return line.length > 200 ? `${line.slice(0, 200)}...` : line;
  }
  return null;
}

function stripDiagnosticMeta(
  details: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const output = { ...details };
  delete output.hint;
  delete output.diagnosticId;
  delete output.logPath;
  return Object.keys(output).length > 0 ? output : undefined;
}

export function defaultHintForCode(code: string): string | undefined {
  switch (code) {
    case 'INVALID_ARGS':
      return 'Check command arguments and run --help for usage examples.';
    case 'SESSION_NOT_FOUND':
      return 'Run open first or pass an explicit device selector.';
    case 'TOOL_MISSING':
      return 'Install required platform tooling and ensure it is available in PATH.';
    case 'DEVICE_NOT_FOUND':
      return 'Verify the target device is booted/connected and selectors match.';
    case 'APP_NOT_INSTALLED':
      return 'Run apps to discover the exact installed package or bundle id, or install the app before open.';
    case 'UNSUPPORTED_OPERATION':
      return 'This command is not available for the selected platform/device.';
    case 'NOT_IMPLEMENTED':
      return 'This command is part of the planned API but is not implemented yet.';
    case 'COMMAND_FAILED':
      return 'Retry with --debug and inspect diagnostics log for details.';
    case 'UNAUTHORIZED':
      return 'Refresh daemon metadata and retry the command.';
    default:
      return 'Retry with --debug and inspect diagnostics log for details.';
  }
}
