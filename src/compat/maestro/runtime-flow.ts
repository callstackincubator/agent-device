import { type CommandFlags } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../../daemon/types.ts';
import { getSnapshotReferenceFrame } from '../../daemon/touch-reference-frame.ts';
import {
  batchStepToSessionAction,
  captureMaestroRawSnapshot,
  errorResponse,
  readSnapshotState,
  type MaestroReplayInvoker,
  type ReplayBaseRequest,
} from './runtime-support.ts';
import {
  readMaestroSelectorPlatform,
  resolveVisibleMaestroNodeFromSnapshot,
} from './runtime-targets.ts';

type MaestroRunFlowWhenCondition =
  | { ok: true; mode: string; predicate: string; selector: string }
  | { ok: false; response: DaemonResponse };

export async function invokeMaestroRunFlowWhen(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  batchSteps: CommandFlags['batchSteps'] | undefined;
  line: number;
  step: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction: MaestroReplayInvoker;
}): Promise<DaemonResponse> {
  const condition = readMaestroRunFlowWhenCondition(params.positionals);
  if (!condition.ok) return condition.response;
  const conditionResult = await evaluateMaestroRunFlowWhenCondition(params, condition);
  if (!conditionResult.ok) return conditionResult.response;
  if (!conditionResult.matched) {
    return {
      ok: true,
      data: { skipped: true, condition: condition.mode, selector: condition.selector },
    };
  }
  return await invokeMaestroRunFlowWhenSteps(params, condition);
}

export async function invokeMaestroRetry(params: {
  positionals: string[];
  batchSteps: CommandFlags['batchSteps'] | undefined;
  line: number;
  step: number;
  invokeReplayAction: MaestroReplayInvoker;
}): Promise<DaemonResponse> {
  const [maxRetriesValue = '1'] = params.positionals;
  const maxRetries = Number(maxRetriesValue);
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    return errorResponse('INVALID_ARGS', 'retry.maxRetries must be a non-negative integer.');
  }

  const steps = (params.batchSteps ?? []).map(batchStepToSessionAction);
  let lastResponse: DaemonResponse | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await invokeMaestroRetryAttempt(params, steps, attempt);
    if (response.ok) {
      return { ok: true, data: { attempts: attempt + 1, retried: attempt > 0 } };
    }
    lastResponse = response;
  }
  return lastResponse ?? errorResponse('COMMAND_FAILED', 'retry commands failed.');
}

function readMaestroRunFlowWhenCondition(positionals: string[]): MaestroRunFlowWhenCondition {
  const [mode, selector] = positionals;
  if ((mode !== 'visible' && mode !== 'notVisible') || !selector) {
    return {
      ok: false,
      response: errorResponse(
        'INVALID_ARGS',
        'runFlow.when requires visible/notVisible and a selector.',
      ),
    };
  }
  return {
    ok: true,
    mode,
    predicate: mode === 'visible' ? 'visible' : 'hidden',
    selector,
  };
}

async function evaluateMaestroRunFlowWhenCondition(
  params: {
    baseReq: ReplayBaseRequest;
    invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  },
  condition: Extract<MaestroRunFlowWhenCondition, { ok: true }>,
): Promise<{ ok: true; matched: boolean } | { ok: false; response: DaemonResponse }> {
  const response = await captureMaestroRawSnapshot(params);
  if (!response.ok) return { ok: false, response };
  const snapshot = readSnapshotState(response.data);
  if (!snapshot) {
    return {
      ok: false,
      response: errorResponse('COMMAND_FAILED', 'Unable to read snapshot data for runFlow.when.'),
    };
  }
  const visible = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    condition.selector,
    readMaestroSelectorPlatform(params.baseReq.flags),
    getSnapshotReferenceFrame(snapshot),
  ).ok;
  return { ok: true, matched: condition.mode === 'visible' ? visible : !visible };
}

async function invokeMaestroRunFlowWhenSteps(
  params: {
    batchSteps: CommandFlags['batchSteps'] | undefined;
    line: number;
    step: number;
    invokeReplayAction: MaestroReplayInvoker;
  },
  condition: Extract<MaestroRunFlowWhenCondition, { ok: true }>,
): Promise<DaemonResponse> {
  const steps = (params.batchSteps ?? []).map(batchStepToSessionAction);
  for (const [index, action] of steps.entries()) {
    // Preserve stable parent-step ordering for nested runtime commands while
    // keeping the substep distinguishable in traces.
    const response = await params.invokeReplayAction({
      action,
      line: params.line,
      step: params.step + index / 1000,
    });
    if (!response.ok) return response;
  }

  return {
    ok: true,
    data: { ran: steps.length, condition: condition.mode, selector: condition.selector },
  };
}

async function invokeMaestroRetryAttempt(
  params: {
    line: number;
    step: number;
    invokeReplayAction: MaestroReplayInvoker;
  },
  steps: SessionAction[],
  attempt: number,
): Promise<DaemonResponse> {
  for (const [index, action] of steps.entries()) {
    const response = await params.invokeReplayAction({
      action,
      line: params.line,
      step: params.step + attempt + index / 1000,
    });
    if (!response.ok) return response;
  }
  return { ok: true, data: { ran: steps.length } };
}
