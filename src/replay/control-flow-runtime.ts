import type { DaemonResponse, SessionAction } from '../daemon/types.ts';

export type ReplayActionBlockInvoker = (params: {
  action: SessionAction;
  line: number;
  step: number;
}) => Promise<DaemonResponse>;

export async function invokeReplayActionBlock(params: {
  actions: SessionAction[];
  line: number;
  step: number;
  invokeReplayAction: ReplayActionBlockInvoker;
}): Promise<DaemonResponse> {
  for (const [index, action] of params.actions.entries()) {
    const response = await params.invokeReplayAction({
      action,
      line: params.line,
      step: params.step + index / 1000,
    });
    if (!response.ok) return response;
  }
  return { ok: true, data: { ran: params.actions.length } };
}

export async function invokeReplayRetryBlock(params: {
  actions: SessionAction[];
  maxRetries: number;
  line: number;
  step: number;
  invokeReplayAction: ReplayActionBlockInvoker;
}): Promise<DaemonResponse> {
  let lastResponse: DaemonResponse | undefined;
  for (let attempt = 0; attempt <= params.maxRetries; attempt += 1) {
    const response = await invokeReplayActionBlock({
      actions: params.actions,
      line: params.line,
      step: params.step + attempt,
      invokeReplayAction: params.invokeReplayAction,
    });
    if (response.ok) {
      return { ok: true, data: { attempts: attempt + 1, retried: attempt > 0 } };
    }
    lastResponse = response;
  }
  return (
    lastResponse ?? {
      ok: false,
      error: { code: 'COMMAND_FAILED', message: 'retry commands failed.' },
    }
  );
}
