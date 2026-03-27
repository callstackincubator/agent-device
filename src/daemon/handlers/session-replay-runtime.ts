import fs from 'node:fs';
import { type CommandFlags } from '../../core/dispatch.ts';
import { asAppError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { parseReplayScript, writeReplayScript } from './session-replay-script.ts';
import { healReplayAction } from './session-replay-heal.ts';
import { formatScriptActionSummary } from '../script-utils.ts';

const REPLAY_PARENT_FLAG_KEYS: Array<keyof CommandFlags> = [
  'platform',
  'target',
  'device',
  'udid',
  'serial',
  'verbose',
  'out',
];

export async function runReplayScriptFile(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore, invoke } = params;
  const filePath = req.positionals?.[0];
  if (!filePath) {
    return { ok: false, error: { code: 'INVALID_ARGS', message: 'replay requires a path' } };
  }

  let resolved = '';
  const artifactPaths = new Set<string>();
  try {
    resolved = SessionStore.expandHome(filePath, req.meta?.cwd);
    const script = fs.readFileSync(resolved, 'utf8');
    const firstNonWhitespace = script.trimStart()[0];
    if (firstNonWhitespace === '{' || firstNonWhitespace === '[') {
      return {
        ok: false,
        error: {
          code: 'INVALID_ARGS',
          message: 'replay accepts .ad script files. JSON replay payloads are no longer supported.',
        },
      };
    }

    const actions = parseReplayScript(script);
    const shouldUpdate = req.flags?.replayUpdate === true;
    let healed = 0;
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      if (!action || action.command === 'replay') continue;

      let response = await invokeReplayAction({
        req,
        sessionName,
        action,
        invoke,
      });
      if (response.ok) {
        collectReplayActionArtifactPaths(response).forEach((entry) => artifactPaths.add(entry));
        continue;
      }
      if (!shouldUpdate) {
        return withReplayFailureContext(response, action, index, resolved, [...artifactPaths]);
      }

      const nextAction = await healReplayAction({
        action,
        sessionName,
        logPath,
        sessionStore,
      });
      if (!nextAction) {
        return withReplayFailureContext(response, action, index, resolved, [...artifactPaths]);
      }

      actions[index] = nextAction;
      response = await invokeReplayAction({
        req,
        sessionName,
        action: nextAction,
        invoke,
      });
      if (!response.ok) {
        return withReplayFailureContext(response, nextAction, index, resolved, [...artifactPaths]);
      }
      collectReplayActionArtifactPaths(response).forEach((entry) => artifactPaths.add(entry));
      healed += 1;
    }

    if (shouldUpdate && healed > 0) {
      writeReplayScript(resolved, actions, sessionStore.get(sessionName));
    }
    return {
      ok: true,
      data: {
        replayed: actions.length,
        healed,
        session: sessionName,
        artifactPaths: [...artifactPaths],
      },
    };
  } catch (err) {
    const appErr = asAppError(err);
    return {
      ok: false,
      error: {
        code: appErr.code,
        message: appErr.message,
        details: artifactPaths.size > 0 ? { artifactPaths: [...artifactPaths] } : undefined,
      },
    };
  }
}

async function invokeReplayAction(params: {
  req: DaemonRequest;
  sessionName: string;
  action: SessionAction;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const { req, sessionName, action, invoke } = params;
  return await invoke({
    token: req.token,
    session: sessionName,
    command: action.command,
    positionals: action.positionals ?? [],
    flags: buildReplayActionFlags(req.flags, action.flags),
    runtime: action.runtime,
    meta: req.meta,
  });
}

export function withReplayFailureContext(
  response: DaemonResponse,
  action: SessionAction,
  index: number,
  replayPath: string,
  artifactPaths: string[] = [],
): DaemonResponse {
  if (response.ok) return response;
  const step = index + 1;
  return {
    ok: false,
    error: {
      code: response.error.code,
      message: `Replay failed at step ${step} (${formatScriptActionSummary(action)}): ${response.error.message}`,
      hint: response.error.hint,
      diagnosticId: response.error.diagnosticId,
      logPath: response.error.logPath,
      details: {
        ...(response.error.details ?? {}),
        replayPath,
        step,
        action: action.command,
        positionals: action.positionals ?? [],
        artifactPaths,
      },
    },
  };
}

export function collectReplayActionArtifactPaths(response: DaemonResponse): string[] {
  if (!response.ok || !response.data) return [];
  const candidates: string[] = [];
  if (typeof response.data.path === 'string') candidates.push(response.data.path);
  if (typeof response.data.outPath === 'string') candidates.push(response.data.outPath);
  if (Array.isArray(response.data.artifacts)) {
    for (const artifact of response.data.artifacts) {
      if (!artifact || typeof artifact !== 'object') continue;
      const artifactRecord = artifact as Record<string, unknown>;
      const localPath =
        typeof artifactRecord.localPath === 'string' ? artifactRecord.localPath : undefined;
      const artifactPath =
        typeof artifactRecord.path === 'string' ? artifactRecord.path : undefined;
      if (localPath) candidates.push(localPath);
      else if (artifactPath) candidates.push(artifactPath);
    }
  }
  return [...new Set(candidates.filter((candidate) => isReplayArtifactPath(candidate)))];
}

function isReplayArtifactPath(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

export function buildReplayActionFlags(
  parentFlags: CommandFlags | undefined,
  actionFlags: SessionAction['flags'] | undefined,
): CommandFlags {
  const merged: CommandFlags = { ...(actionFlags ?? {}) };
  const mergedRecord = merged as Record<string, unknown>;
  const parentRecord = (parentFlags ?? {}) as Record<string, unknown>;
  for (const key of REPLAY_PARENT_FLAG_KEYS) {
    if (mergedRecord[key] === undefined && parentRecord[key] !== undefined) {
      mergedRecord[key] = parentRecord[key];
    }
  }
  return merged;
}
