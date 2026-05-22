import { type CommandFlags } from '../../core/dispatch.ts';
import { MAESTRO_RUNTIME_COMMAND } from '../../compat/maestro/runtime-commands.ts';
import type { SnapshotState } from '../../utils/snapshot.ts';
import { sleep } from '../../utils/timeouts.ts';
import { parseSelectorChain } from '../selectors.ts';
import { getSnapshotReferenceFrame } from '../touch-reference-frame.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../types.ts';
import { errorResponse } from './response.ts';

const MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS = 500;
const MAESTRO_TAP_ON_TIMEOUT_MS = 30000;
const MAESTRO_TAP_ON_RETRY_MS = 250;

type ReplayBaseRequest = Omit<DaemonRequest, 'command' | 'positionals'>;

type MaestroReplayInvoker = (params: {
  action: SessionAction;
  line: number;
  step: number;
}) => Promise<DaemonResponse>;

type MaestroRuntimeInvoke = (req: DaemonRequest) => Promise<DaemonResponse>;

type MaestroScrollUntilVisibleParams = {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
};

type MaestroTapOnParams = {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: MaestroRuntimeInvoke;
};

export async function invokeMaestroRuntimeCommand(params: {
  command: string;
  baseReq: ReplayBaseRequest;
  positionals: string[];
  batchSteps: CommandFlags['batchSteps'] | undefined;
  line: number;
  step: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction: MaestroReplayInvoker;
}): Promise<DaemonResponse | undefined> {
  switch (params.command) {
    case MAESTRO_RUNTIME_COMMAND.scrollUntilVisible:
      return await invokeMaestroScrollUntilVisible(params);
    case MAESTRO_RUNTIME_COMMAND.tapOn:
      return await invokeMaestroTapOn(params);
    case MAESTRO_RUNTIME_COMMAND.tapPointPercent:
      return await invokeMaestroTapPointPercent(params);
    case MAESTRO_RUNTIME_COMMAND.runFlowWhen:
      return await invokeMaestroRunFlowWhen(params);
    case MAESTRO_RUNTIME_COMMAND.pressEnter:
      return await invokeMaestroPressEnter(params);
    default:
      return undefined;
  }
}

async function invokeMaestroScrollUntilVisible(
  params: MaestroScrollUntilVisibleParams,
): Promise<DaemonResponse> {
  const [selector, timeoutValue = '5000', direction = 'down'] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'scrollUntilVisible requires a selector.');
  }
  const timeoutMs = Number(timeoutValue);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return errorResponse('INVALID_ARGS', 'scrollUntilVisible timeout must be a positive number.');
  }
  const fuzzyTextQuery = extractMaestroVisibleTextQuery(selector);
  const attempts = Math.max(1, Math.ceil(timeoutMs / MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS));
  let lastWaitResponse: DaemonResponse | undefined;

  for (let index = 0; index < attempts; index += 1) {
    const probe = await probeMaestroScrollVisibility(
      params,
      selector,
      fuzzyTextQuery,
      scrollProbeMs(timeoutMs, index),
    );
    if (probe.visible) return probe.response;
    lastWaitResponse = probe.response;

    if (index === attempts - 1) break;

    const scrollResponse = await params.invoke({
      ...params.baseReq,
      command: 'scroll',
      positionals: [direction],
    });
    if (!scrollResponse.ok) return scrollResponse;
  }

  return withMaestroScrollTimeoutContext(lastWaitResponse, selector, timeoutMs);
}

async function probeMaestroScrollVisibility(
  params: MaestroScrollUntilVisibleParams,
  selector: string,
  fuzzyTextQuery: string | null,
  probeMs: number,
): Promise<{ visible: boolean; response: DaemonResponse }> {
  const waitResponse = await params.invoke({
    ...params.baseReq,
    command: 'wait',
    positionals: [selector, String(probeMs)],
  });
  if (waitResponse.ok) return { visible: true, response: waitResponse };
  if (!fuzzyTextQuery) return { visible: false, response: waitResponse };

  const fuzzyResponse = await params.invoke({
    ...params.baseReq,
    command: 'find',
    positionals: [fuzzyTextQuery, 'wait', String(probeMs)],
  });
  return { visible: fuzzyResponse.ok, response: fuzzyResponse };
}

function scrollProbeMs(timeoutMs: number, index: number): number {
  return Math.min(
    MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS,
    Math.max(1, timeoutMs - index * MAESTRO_SCROLL_UNTIL_VISIBLE_PROBE_MS),
  );
}

async function invokeMaestroTapPointPercent(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const [xValue, yValue] = params.positionals;
  const xPercent = Number(xValue);
  const yPercent = Number(yValue);
  if (!Number.isFinite(xPercent) || !Number.isFinite(yPercent)) {
    return errorResponse('INVALID_ARGS', 'tapOn percentage point requires numeric x/y values.');
  }

  const snapshotResponse = await params.invoke({
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
  if (!snapshotResponse.ok) return snapshotResponse;

  const snapshot = readSnapshotState(snapshotResponse.data);
  if (!snapshot) {
    return errorResponse(
      'COMMAND_FAILED',
      'Unable to read snapshot data for Maestro percentage point tap.',
    );
  }

  const frame = getSnapshotReferenceFrame(snapshot);
  if (!frame) {
    return errorResponse(
      'COMMAND_FAILED',
      'Unable to resolve screen size for Maestro percentage point tap.',
    );
  }

  return await params.invoke({
    ...params.baseReq,
    command: 'click',
    positionals: [
      String(Math.round((frame.referenceWidth * xPercent) / 100)),
      String(Math.round((frame.referenceHeight * yPercent) / 100)),
    ],
  });
}

function readSnapshotState(data: unknown): SnapshotState | undefined {
  if (
    typeof data === 'object' &&
    data !== null &&
    Array.isArray((data as { nodes?: unknown }).nodes)
  ) {
    return data as SnapshotState;
  }
  return undefined;
}

async function invokeMaestroTapOn(params: MaestroTapOnParams): Promise<DaemonResponse> {
  const [selector] = params.positionals;
  if (!selector) {
    return errorResponse('INVALID_ARGS', 'tapOn requires a selector.');
  }
  const startedAt = Date.now();
  const fuzzyTextQuery = extractMaestroVisibleTextQuery(selector);
  let lastResponse: DaemonResponse | undefined;
  while (Date.now() - startedAt < MAESTRO_TAP_ON_TIMEOUT_MS) {
    if (fuzzyTextQuery) {
      const attempt = await invokeMaestroFuzzyTapOn(params, fuzzyTextQuery);
      if (!attempt.retry) return attempt.response;
      lastResponse = attempt.response;
      await sleep(MAESTRO_TAP_ON_RETRY_MS);
      continue;
    }

    const clickResponse = await params.invoke({
      ...params.baseReq,
      command: 'click',
      positionals: [selector],
    });
    if (clickResponse.ok) return clickResponse;
    lastResponse = clickResponse;
    await sleep(MAESTRO_TAP_ON_RETRY_MS);
  }

  if (params.baseReq.flags?.maestroOptional === true) {
    return { ok: true, data: { skipped: true, optional: true, selector } };
  }
  return (
    lastResponse ?? errorResponse('COMMAND_FAILED', `tapOn timed out for selector: ${selector}`)
  );
}

async function invokeMaestroFuzzyTapOn(
  params: MaestroTapOnParams,
  query: string,
): Promise<{ retry: boolean; response: DaemonResponse }> {
  const findResponse = await params.invoke({
    ...params.baseReq,
    command: 'find',
    positionals: [query, 'click'],
  });
  if (findResponse.ok) return { retry: false, response: findResponse };
  if (params.baseReq.flags?.maestroOptional !== true) {
    return { retry: true, response: findResponse };
  }

  const nativeLabelResponse = await params.invoke({
    ...params.baseReq,
    command: 'click',
    positionals: [simpleLabelSelector(query)],
  });
  return { retry: !nativeLabelResponse.ok, response: nativeLabelResponse };
}

async function invokeMaestroRunFlowWhen(params: {
  baseReq: ReplayBaseRequest;
  positionals: string[];
  batchSteps: CommandFlags['batchSteps'] | undefined;
  line: number;
  step: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction: MaestroReplayInvoker;
}): Promise<DaemonResponse> {
  const [mode, selector] = params.positionals;
  if ((mode !== 'visible' && mode !== 'notVisible') || !selector) {
    return errorResponse(
      'INVALID_ARGS',
      'runFlow.when requires visible/notVisible and a selector.',
    );
  }
  const predicate = mode === 'visible' ? 'visible' : 'hidden';
  const conditionResponse = await params.invoke({
    ...params.baseReq,
    command: 'is',
    positionals: [predicate, selector],
    flags: { ...params.baseReq.flags, noRecord: true },
  });
  if (!conditionResponse.ok) {
    return { ok: true, data: { skipped: true, condition: mode, selector } };
  }

  const steps = (params.batchSteps ?? []).map(batchStepToSessionAction);
  for (const [index, action] of steps.entries()) {
    const response = await params.invokeReplayAction({
      action,
      line: params.line,
      step: params.step + index / 1000,
    });
    if (!response.ok) return response;
  }

  return { ok: true, data: { ran: steps.length, condition: mode, selector } };
}

async function invokeMaestroPressEnter(params: {
  baseReq: ReplayBaseRequest;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const response = await params.invoke({
    ...params.baseReq,
    command: 'type',
    positionals: ['\n'],
  });
  if (response.ok) return response;
  const message = response.error.message.toLowerCase();
  if (!message.includes('fetch failed')) return response;

  const snapshotResponse = await params.invoke({
    ...params.baseReq,
    command: 'snapshot',
    positionals: [],
    flags: { ...params.baseReq.flags, noRecord: true },
  });
  if (!snapshotResponse.ok) return response;
  return {
    ok: true,
    data: {
      recovered: true,
      warning: 'Enter key submit reset the iOS runner transport; recovered after snapshot.',
    },
  };
}

function batchStepToSessionAction(
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

function extractMaestroVisibleTextQuery(selectorExpression: string): string | null {
  const chain = parseSelectorChain(selectorExpression);
  const terms = chain.selectors.flatMap((selector) => selector.terms);
  if (terms.length === 0) return null;
  if (!terms.some((term) => term.key === 'label' || term.key === 'text')) return null;
  if (!terms.every((term) => ['label', 'text', 'id'].includes(term.key))) return null;
  const values = terms.map((term) => (typeof term.value === 'string' ? term.value : ''));
  const first = values[0];
  if (!first || !values.every((value) => value === first)) return null;
  return first;
}

function simpleLabelSelector(value: string): string {
  return `label=${JSON.stringify(value)}`;
}

function withMaestroScrollTimeoutContext(
  response: DaemonResponse | undefined,
  selector: string,
  timeoutMs: number,
): DaemonResponse {
  if (!response || response.ok) {
    return errorResponse(
      'COMMAND_FAILED',
      `scrollUntilVisible timed out after ${timeoutMs}ms for selector: ${selector}`,
    );
  }
  return {
    ok: false,
    error: {
      ...response.error,
      message: `scrollUntilVisible timed out after ${timeoutMs}ms for selector: ${selector}. Last wait: ${response.error.message}`,
    },
  };
}
