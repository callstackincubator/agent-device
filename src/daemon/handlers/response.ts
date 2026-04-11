import type { DaemonResponse } from '../types.ts';

export type DaemonFailureResponse = Extract<DaemonResponse, { ok: false }>;

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): DaemonFailureResponse {
  return {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  };
}
