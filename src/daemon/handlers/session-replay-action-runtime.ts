import fs from 'node:fs';
import type { CommandFlags } from '../../core/dispatch.ts';
import {
  mergeReplayVarScopeValues,
  resolveReplayAction,
  type ReplayVarScope,
} from '../../replay/vars.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../types.ts';
import { mergeParentFlags } from './handler-utils.ts';
import { invokeMaestroRuntimeCommand } from '../../compat/maestro/runtime.ts';

type ReplayBaseRequest = Omit<DaemonRequest, 'command' | 'positionals'>;

type ReplayActionInvoker = (params: {
  action: SessionAction;
  line: number;
  step: number;
}) => Promise<DaemonResponse>;

export async function invokeReplayAction(params: {
  req: DaemonRequest;
  sessionName: string;
  action: SessionAction;
  scope: ReplayVarScope;
  filePath: string;
  line: number;
  step: number;
  tracePath?: string;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const { req, sessionName, action, scope, filePath, line, step, tracePath, invoke } = params;
  const resolved = resolveReplayAction(action, scope, { file: filePath, line });
  const invokeNestedReplayAction: ReplayActionInvoker = (nested) =>
    invokeReplayAction({
      req,
      sessionName,
      action: nested.action,
      scope,
      filePath,
      line: nested.line,
      step: nested.step,
      tracePath,
      invoke,
    });
  const startedAt = Date.now();
  appendReplayTraceEvent(tracePath, {
    type: 'replay_action_start',
    ts: new Date(startedAt).toISOString(),
    replayPath: filePath,
    line,
    step,
    command: resolved.command,
    positionals: resolved.positionals ?? [],
  });

  const response = await invokeResolvedReplayAction({
    req,
    sessionName,
    resolved,
    scope,
    line,
    step,
    invoke,
    invokeReplayAction: invokeNestedReplayAction,
  });

  const finishedAt = Date.now();
  appendReplayTraceEvent(tracePath, {
    type: 'replay_action_stop',
    ts: new Date(finishedAt).toISOString(),
    replayPath: filePath,
    line,
    step,
    command: resolved.command,
    ok: response.ok,
    durationMs: finishedAt - startedAt,
    errorCode: response.ok ? undefined : response.error.code,
  });
  return response;
}

async function invokeResolvedReplayAction(params: {
  req: DaemonRequest;
  sessionName: string;
  resolved: SessionAction;
  scope: ReplayVarScope;
  line: number;
  step: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  invokeReplayAction: ReplayActionInvoker;
}): Promise<DaemonResponse> {
  const { req, sessionName, resolved, scope, line, step, invoke, invokeReplayAction } = params;
  const flags = buildReplayActionFlags(req.flags, resolved.flags);
  const baseReq: ReplayBaseRequest = {
    token: req.token,
    session: sessionName,
    flags,
    runtime: resolved.runtime,
    meta: req.meta,
  };
  const response =
    (await invokeMaestroRuntimeCommand({
      command: resolved.command,
      baseReq,
      positionals: resolved.positionals ?? [],
      batchSteps: resolved.flags?.batchSteps,
      scope,
      line,
      step,
      invoke,
      invokeReplayAction,
    })) ??
    (await invoke({
      ...baseReq,
      command: resolved.command,
      positionals: resolved.positionals ?? [],
    }));
  if (response.ok) {
    const outputEnv = readReplayOutputEnv(response.data);
    if (outputEnv) mergeReplayVarScopeValues(scope, outputEnv);
  }
  return response;
}

function readReplayOutputEnv(data: unknown): Record<string, string> | null {
  if (!data || typeof data !== 'object') return null;
  const raw = (data as { outputEnv?: unknown }).outputEnv;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const entries = Object.entries(raw).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function appendReplayTraceEvent(
  tracePath: string | undefined,
  event: Record<string, unknown>,
): void {
  if (!tracePath) return;
  fs.appendFileSync(tracePath, `${JSON.stringify(event)}\n`);
}

function buildReplayActionFlags(
  parentFlags: CommandFlags | undefined,
  actionFlags: SessionAction['flags'] | undefined,
): CommandFlags {
  return mergeParentFlags(parentFlags, { ...(actionFlags ?? {}) });
}
