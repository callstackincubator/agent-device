import fs from 'node:fs';
import path from 'node:path';
import { type CommandFlags } from '../../core/dispatch.ts';
import { asAppError } from '../../utils/errors.ts';
import type { DaemonRequest, DaemonResponse, SessionAction } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import {
  parseReplayScriptDetailed,
  readReplayScriptMetadata,
  writeReplayScript,
} from './session-replay-script.ts';
import { healReplayAction } from './session-replay-heal.ts';
import { formatScriptActionSummary } from '../script-utils.ts';
import { mergeParentFlags } from './handler-utils.ts';
import { errorResponse } from './response.ts';
import {
  buildReplayVarScope,
  collectReplayShellEnv,
  parseReplayCliEnvEntries,
  resolveReplayAction,
  type ReplayVarScope,
} from './session-replay-vars.ts';

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
    return errorResponse('INVALID_ARGS', 'replay requires a path');
  }

  let resolved = '';
  const artifactPaths = new Set<string>();
  try {
    resolved = SessionStore.expandHome(filePath, req.meta?.cwd);
    const script = fs.readFileSync(resolved, 'utf8');
    const firstNonWhitespace = script.trimStart()[0];
    if (firstNonWhitespace === '{' || firstNonWhitespace === '[') {
      return errorResponse(
        'INVALID_ARGS',
        'replay accepts .ad script files. JSON replay payloads are no longer supported.',
      );
    }

    const metadata = readReplayScriptMetadata(script);
    const parsed = parseReplayScriptDetailed(script);
    const actions = parsed.actions;
    const actionLines = parsed.actionLines;
    if (req.flags?.replayUpdate === true && metadata.env && Object.keys(metadata.env).length > 0) {
      return errorResponse(
        'INVALID_ARGS',
        'replay -u does not yet preserve env directives. Temporarily remove the env lines, run replay -u, then restore them.',
      );
    }
    if (req.flags?.replayUpdate === true && actionsContainInterpolation(actions)) {
      return errorResponse(
        'INVALID_ARGS',
        'replay -u does not yet preserve ${VAR} substitutions. Resolve or inline the variables before running with -u.',
      );
    }
    const scope = buildReplayVarScope({
      builtins: buildReplayBuiltinVars({
        req,
        sessionName,
        metadata,
        resolvedPath: resolved,
      }),
      fileEnv: metadata.env,
      shellEnv: collectReplayShellEnv(process.env),
      cliEnv: parseReplayCliEnvEntries(readCliEnvEntries(req)),
    });
    const shouldUpdate = req.flags?.replayUpdate === true;
    let healed = 0;
    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index];
      if (!action || action.command === 'replay') continue;

      let response = await invokeReplayAction({
        req,
        sessionName,
        action,
        scope,
        filePath: resolved,
        line: actionLines[index] ?? 0,
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
        scope,
        filePath: resolved,
        line: actionLines[index] ?? 0,
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
    return errorResponse(
      appErr.code,
      appErr.message,
      artifactPaths.size > 0 ? { artifactPaths: [...artifactPaths] } : undefined,
    );
  }
}

async function invokeReplayAction(params: {
  req: DaemonRequest;
  sessionName: string;
  action: SessionAction;
  scope: ReplayVarScope;
  filePath: string;
  line: number;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
}): Promise<DaemonResponse> {
  const { req, sessionName, action, scope, filePath, line, invoke } = params;
  const resolved = resolveReplayAction(action, scope, { file: filePath, line });
  return await invoke({
    token: req.token,
    session: sessionName,
    command: resolved.command,
    positionals: resolved.positionals ?? [],
    flags: buildReplayActionFlags(req.flags, resolved.flags),
    runtime: resolved.runtime,
    meta: req.meta,
  });
}

function buildReplayBuiltinVars(params: {
  req: DaemonRequest;
  sessionName: string;
  metadata: ReturnType<typeof readReplayScriptMetadata>;
  resolvedPath: string;
}): Record<string, string> {
  const { req, sessionName, metadata, resolvedPath } = params;
  const flags = req.flags ?? {};
  const cwd = req.meta?.cwd ?? process.cwd();
  const filename = path.relative(cwd, resolvedPath) || resolvedPath;
  const builtins: Record<string, string> = {
    AD_SESSION: sessionName,
    AD_FILENAME: filename,
  };
  const platform = (flags.platform as string | undefined) ?? metadata.platform;
  if (platform) builtins.AD_PLATFORM = platform;
  const device = flags.device;
  if (typeof device === 'string' && device.length > 0) builtins.AD_DEVICE = device;
  const artifactsDir = flags.artifactsDir;
  if (typeof artifactsDir === 'string' && artifactsDir.length > 0) {
    builtins.AD_ARTIFACTS = artifactsDir;
  }
  return builtins;
}

function readCliEnvEntries(req: DaemonRequest): string[] {
  const raw = req.flags?.replayEnv;
  return Array.isArray(raw) ? raw.filter((value): value is string => typeof value === 'string') : [];
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
  return mergeParentFlags(parentFlags, { ...(actionFlags ?? {}) });
}

function actionsContainInterpolation(actions: SessionAction[]): boolean {
  for (const action of actions) {
    for (const positional of action.positionals ?? []) {
      if (typeof positional === 'string' && positional.includes('${')) return true;
    }
    if (action.flags) {
      for (const value of Object.values(action.flags)) {
        if (typeof value === 'string' && value.includes('${')) return true;
      }
    }
    if (action.runtime) {
      for (const value of Object.values(action.runtime)) {
        if (typeof value === 'string' && value.includes('${')) return true;
      }
    }
  }
  return false;
}
