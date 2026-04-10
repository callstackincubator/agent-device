import type { DaemonResponse } from '../types.ts';

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DaemonResponse {
  return {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  };
}

export function sessionNotFoundResponse(): DaemonResponse {
  return errorResponse('SESSION_NOT_FOUND', 'No active session. Run open first.');
}

export function unsupportedOperationResponse(command: string): DaemonResponse {
  return errorResponse('UNSUPPORTED_OPERATION', `${command} is not supported on this device`);
}
