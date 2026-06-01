import {
  getSnapshotReferenceFrame,
  type TouchReferenceFrame,
} from '../../daemon/touch-reference-frame.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../../daemon/types.ts';
import type { ReplayVarScope } from '../../replay/vars.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';

export type ReplayBaseRequest = Omit<DaemonRequest, 'command' | 'positionals'>;

export type MaestroReplayInvoker = (params: {
  action: SessionAction;
  line: number;
  step: number;
}) => Promise<DaemonResponse>;

export type MaestroRuntimeInvoke = (req: DaemonRequest) => Promise<DaemonResponse>;

export type FailedDaemonResponse = Extract<DaemonResponse, { ok: false }>;

const maestroReferenceFrameCache = new WeakMap<ReplayVarScope, TouchReferenceFrame>();
const maestroVisibleContextCache = new WeakMap<ReplayVarScope, { selector: string }>();

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): FailedDaemonResponse {
  return {
    ok: false,
    error: { code, message, ...(details ? { details } : {}) },
  };
}

export async function captureMaestroRawSnapshot(params: {
  baseReq: ReplayBaseRequest;
  invoke: MaestroRuntimeInvoke;
  scope?: ReplayVarScope;
}): Promise<DaemonResponse> {
  const response = await params.invoke({
    ...params.baseReq,
    command: 'snapshot',
    positionals: [],
    flags: {
      ...params.baseReq.flags,
      noRecord: true,
      snapshotRaw: true,
      snapshotForceFull: true,
    },
  });
  if (response.ok && params.scope) rememberMaestroReferenceFrame(params.scope, response.data);
  return response;
}

export function readSnapshotState(data: unknown): SnapshotState | undefined {
  if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { nodes?: unknown }).nodes)
  ) {
    return data as SnapshotState;
  }
  return undefined;
}

export function readCachedMaestroReferenceFrame(
  scope: ReplayVarScope | undefined,
): TouchReferenceFrame | undefined {
  return scope ? maestroReferenceFrameCache.get(scope) : undefined;
}

export function rememberMaestroVisibleContext(
  scope: ReplayVarScope | undefined,
  selector: string,
): void {
  if (scope) maestroVisibleContextCache.set(scope, { selector });
}

export function readMaestroVisibleContext(
  scope: ReplayVarScope | undefined,
): { selector: string } | undefined {
  return scope ? maestroVisibleContextCache.get(scope) : undefined;
}

export function clearMaestroVisibleContext(scope: ReplayVarScope | undefined): void {
  if (scope) maestroVisibleContextCache.delete(scope);
}

function rememberMaestroReferenceFrame(scope: ReplayVarScope, data: unknown): void {
  const snapshot = readSnapshotState(data);
  const frame = getSnapshotReferenceFrame(snapshot);
  if (frame) maestroReferenceFrameCache.set(scope, frame);
}
