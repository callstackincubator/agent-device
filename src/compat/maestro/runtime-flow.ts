import { type CommandFlags } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse } from '../../daemon/types.ts';
import { getSnapshotReferenceFrame } from '../../daemon/touch-reference-frame.ts';
import {
  batchStepsToSessionActions,
  invokeReplayActionBlock,
  invokeReplayRetryBlock,
} from '../../replay/control-flow-runtime.ts';
import {
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
import { sleep } from '../../utils/timeouts.ts';

const MAESTRO_RUN_FLOW_WHEN_POLICY = {
  visibleTimeoutMs: 3000,
  visiblePollMs: 250,
} as const;

type MaestroRunFlowWhenCondition =
  | { ok: true; mode: string; selector: string }
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

  return await invokeReplayRetryBlock({
    actions: batchStepsToSessionActions(params.batchSteps),
    maxRetries,
    line: params.line,
    step: params.step,
    invokeReplayAction: params.invokeReplayAction,
  });
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
  if (condition.mode === 'visible') {
    return await waitForMaestroRunFlowVisibleCondition(params, condition);
  }

  const response = await captureMaestroRawSnapshot(params);
  if (!response.ok) return { ok: false, response };
  const result = readMaestroRunFlowVisibleCondition(params, condition.selector, response);
  if (!result.ok) {
    return {
      ok: false,
      response: result.response,
    };
  }
  return { ok: true, matched: !result.matched };
}

async function waitForMaestroRunFlowVisibleCondition(
  params: {
    baseReq: ReplayBaseRequest;
    invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  },
  condition: Extract<MaestroRunFlowWhenCondition, { ok: true }>,
): Promise<{ ok: true; matched: boolean } | { ok: false; response: DaemonResponse }> {
  // Maestro conditionals commonly guard UI that appears immediately after the
  // previous command. Keep this bounded and only for visible; notVisible stays
  // a point-in-time condition so optional cleanup blocks do not become waits.
  const startedAt = Date.now();
  while (true) {
    const response = await captureMaestroRawSnapshot(params);
    if (!response.ok) return { ok: false, response };
    const result = readMaestroRunFlowVisibleCondition(params, condition.selector, response);
    if (!result.ok) return { ok: false, response: result.response };
    if (result.matched) return { ok: true, matched: true };
    if (Date.now() - startedAt >= MAESTRO_RUN_FLOW_WHEN_POLICY.visibleTimeoutMs) {
      return { ok: true, matched: false };
    }
    await sleep(MAESTRO_RUN_FLOW_WHEN_POLICY.visiblePollMs);
  }
}

function readMaestroRunFlowVisibleCondition(
  params: {
    baseReq: ReplayBaseRequest;
  },
  selector: string,
  response: Extract<DaemonResponse, { ok: true }>,
): { ok: true; matched: boolean } | { ok: false; response: DaemonResponse } {
  const snapshot = readSnapshotState(response.data);
  if (!snapshot) {
    return {
      ok: false,
      response: errorResponse('COMMAND_FAILED', 'Unable to read snapshot data for runFlow.when.'),
    };
  }
  const matched = resolveVisibleMaestroNodeFromSnapshot(
    snapshot,
    selector,
    readMaestroSelectorPlatform(params.baseReq.flags),
    getSnapshotReferenceFrame(snapshot),
  ).ok;
  return { ok: true, matched };
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
  const response = await invokeReplayActionBlock({
    actions: batchStepsToSessionActions(params.batchSteps),
    line: params.line,
    step: params.step,
    invokeReplayAction: params.invokeReplayAction,
  });
  if (!response.ok) return response;

  return {
    ok: true,
    data: { ran: response.data?.ran, condition: condition.mode, selector: condition.selector },
  };
}
