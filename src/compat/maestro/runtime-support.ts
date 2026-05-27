import type { CommandFlags } from '../../core/dispatch.ts';
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
const maestroSnapshotCache = new WeakMap<
  ReplayVarScope,
  { snapshot: SnapshotState; frame: TouchReferenceFrame | undefined; selector: string }
>();

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

export function rememberMaestroSnapshot(
  scope: ReplayVarScope | undefined,
  data: unknown,
  selector: string,
): void {
  if (!scope) return;
  const snapshot = readSnapshotState(data);
  if (!snapshot) return;
  maestroSnapshotCache.set(scope, {
    snapshot,
    frame: getSnapshotReferenceFrame(snapshot),
    selector,
  });
}

export function consumeMaestroSnapshot(
  scope: ReplayVarScope | undefined,
  selector: string,
): { snapshot: SnapshotState; frame: TouchReferenceFrame | undefined } | undefined {
  if (!scope) return undefined;
  const cached = maestroSnapshotCache.get(scope);
  maestroSnapshotCache.delete(scope);
  return cached?.selector === selector ? cached : undefined;
}

function rememberMaestroReferenceFrame(scope: ReplayVarScope, data: unknown): void {
  const snapshot = readSnapshotState(data);
  const frame = getSnapshotReferenceFrame(snapshot);
  if (frame) maestroReferenceFrameCache.set(scope, frame);
}

export function batchStepToSessionAction(
  step: NonNullable<CommandFlags['batchSteps']>[number],
): SessionAction {
  const action: SessionAction = {
    ts: Date.now(),
    command: step.command,
    positionals: step.positionals ?? [],
    flags: step.flags ?? {},
  };
  if (step.runtime && typeof step.runtime === 'object') {
    action.runtime = step.runtime as SessionAction['runtime'];
  }
  return action;
}
