import {
  getSnapshotReferenceFrame,
  type TouchReferenceFrame,
} from '../../daemon/touch-reference-frame.ts';
import type {
  DaemonRequest,
  DaemonResponse,
  DaemonResponseData,
  SessionAction,
} from '../../daemon/types.ts';
import type { ReplayVarScope } from '../../replay/vars.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import { emitDiagnostic } from '../../utils/diagnostics.ts';

export type ReplayBaseRequest = Omit<DaemonRequest, 'command' | 'positionals'>;

export type MaestroReplayInvoker = (params: {
  action: SessionAction;
  line: number;
  step: number;
}) => Promise<DaemonResponse>;

export type MaestroRuntimeInvoke = (req: DaemonRequest) => Promise<DaemonResponse>;

export type FailedDaemonResponse = Extract<DaemonResponse, { ok: false }>;
export type MaestroSnapshotMode = 'interactive' | 'raw';

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
  mode?: MaestroSnapshotMode;
}): Promise<DaemonResponse> {
  const useRawSnapshot =
    params.mode === 'raw' || process.env.AGENT_DEVICE_MAESTRO_RAW_SNAPSHOTS === '1';
  const response = await params.invoke({
    ...params.baseReq,
    command: 'snapshot',
    positionals: [],
    flags: {
      ...params.baseReq.flags,
      noRecord: true,
      ...(params.mode === 'interactive' && !useRawSnapshot
        ? { snapshotInteractiveOnly: true }
        : {}),
      ...(useRawSnapshot ? { snapshotRaw: true } : {}),
    },
  });
  if (response.ok && params.scope) rememberMaestroReferenceFrame(params.scope, response.data);
  return response;
}

export function readSnapshotState(data: DaemonResponseData | undefined): SnapshotState | undefined {
  return Array.isArray(data?.nodes) ? (data as SnapshotState) : undefined;
}

export function shouldUseMaestroRawSnapshotFallback(baseReq: ReplayBaseRequest): boolean {
  return baseReq.flags?.platform === 'ios';
}

export function emitMaestroRawSnapshotFallbackDiagnostic(command: string, selector: string): void {
  emitDiagnostic({
    level: 'debug',
    phase: 'maestro_raw_snapshot_fallback',
    data: {
      command,
      selector,
      reason: 'optimized_snapshot_missed',
    },
  });
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
