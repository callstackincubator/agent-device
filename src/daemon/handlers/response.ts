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

export function successResponse(data?: Record<string, unknown>): DaemonResponse {
  return { ok: true, data };
}
