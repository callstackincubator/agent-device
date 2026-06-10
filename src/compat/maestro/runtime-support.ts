import {
  getSnapshotReferenceFrame,
  type TouchReferenceFrame,
} from '../../daemon/touch-reference-frame.ts';
import type {
  DaemonInvokeFn,
  DaemonRequest,
  DaemonResponse,
  DaemonResponseData,
} from '../../daemon/types.ts';
import type { DaemonFailureResponse } from '../../daemon/handlers/response.ts';
import type { ReplayActionBlockInvoker } from '../../replay/control-flow-runtime.ts';
import type { ReplayVarScope } from '../../replay/vars.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';

export type ReplayBaseRequest = Omit<DaemonRequest, 'command' | 'positionals'>;

export type MaestroReplayInvoker = ReplayActionBlockInvoker;

export type MaestroRuntimeInvoke = DaemonInvokeFn;

export type FailedDaemonResponse = DaemonFailureResponse;

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

export async function captureMaestroSnapshot(params: {
  baseReq: ReplayBaseRequest;
  invoke: MaestroRuntimeInvoke;
  scope?: ReplayVarScope;
  raw?: boolean;
}): Promise<DaemonResponse> {
  const useRawSnapshot =
    params.raw === true || process.env.AGENT_DEVICE_MAESTRO_RAW_SNAPSHOTS === '1';
  const response = await params.invoke({
    ...params.baseReq,
    command: 'snapshot',
    positionals: [],
    flags: {
      ...params.baseReq.flags,
      noRecord: true,
      ...(useRawSnapshot ? { snapshotRaw: true } : {}),
    },
  });
  if (response.ok && params.scope) rememberMaestroReferenceFrame(params.scope, response.data);
  return response;
}

export function readSnapshotState(data: DaemonResponseData | undefined): SnapshotState | undefined {
  return Array.isArray(data?.nodes) ? (data as SnapshotState) : undefined;
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

function rememberMaestroReferenceFrame(
  scope: ReplayVarScope,
  data: DaemonResponseData | undefined,
): void {
  const snapshot = readSnapshotState(data);
  const frame = getSnapshotReferenceFrame(snapshot);
  if (frame) maestroReferenceFrameCache.set(scope, frame);
}
