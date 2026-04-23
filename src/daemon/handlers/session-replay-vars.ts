import { AppError } from '../../utils/errors.ts';
import type { SessionAction, SessionRuntimeHints } from '../types.ts';

export type ReplayVarScope = {
  readonly values: Readonly<Record<string, string>>;
};

export type ReplayVarSources = {
  builtins?: Record<string, string>;
  fileEnv?: Record<string, string>;
  shellEnv?: Record<string, string>;
  cliEnv?: Record<string, string>;
};

const VAR_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const INTERPOLATION_RE =
  /(\\\$\{)|\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-((?:[^}\\]|\\.)*))?\}/g;
const SHELL_PREFIX = 'AD_';

export function buildReplayVarScope(sources: ReplayVarSources): ReplayVarScope {
  const merged: Record<string, string> = {};
  const layers: Array<Record<string, string> | undefined> = [
    sources.builtins,
    sources.fileEnv,
    sources.shellEnv,
    sources.cliEnv,
  ];
  for (const layer of layers) {
    if (!layer) continue;
    for (const [key, value] of Object.entries(layer)) {
      merged[key] = value;
    }
  }
  return { values: merged };
}

export function collectReplayShellEnv(processEnv: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(processEnv)) {
    if (typeof value !== 'string') continue;
    if (!rawKey.startsWith(SHELL_PREFIX)) continue;
    const key = rawKey.slice(SHELL_PREFIX.length);
    if (key.length === 0) continue;
    if (!VAR_KEY_RE.test(key)) continue;
    result[key] = value;
  }
  return result;
}

export function parseReplayCliEnvEntries(entries: readonly string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const eqIndex = entry.indexOf('=');
    if (eqIndex <= 0) {
      throw new AppError('INVALID_ARGS', `Invalid -e entry "${entry}": expected KEY=VALUE.`);
    }
    const key = entry.slice(0, eqIndex);
    if (!VAR_KEY_RE.test(key)) {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid -e key "${key}": must match /^[A-Z_][A-Z0-9_]*$/.`,
      );
    }
    result[key] = entry.slice(eqIndex + 1);
  }
  return result;
}

export function resolveReplayString(
  raw: string,
  scope: ReplayVarScope,
  loc: { file: string; line: number },
): string {
  return raw.replace(INTERPOLATION_RE, (match, escapedLiteral: string | undefined, key: string | undefined, fallback: string | undefined) => {
    if (escapedLiteral) return '${';
    if (!key) return match;
    if (Object.prototype.hasOwnProperty.call(scope.values, key)) {
      return scope.values[key];
    }
    if (fallback !== undefined) {
      return fallback.replace(/\\(.)/g, '$1');
    }
    throw new AppError(
      'INVALID_ARGS',
      `Unresolved variable \${${key}} at ${loc.file}:${loc.line}.`,
    );
  });
}

export function resolveReplayAction(
  action: SessionAction,
  scope: ReplayVarScope,
  loc: { file: string; line: number },
): SessionAction {
  const positionals = (action.positionals ?? []).map((token) =>
    resolveReplayString(token, scope, loc),
  );
  const flags = resolveReplayFlags(action.flags, scope, loc);
  const runtime = resolveReplayRuntime(action.runtime, scope, loc);
  return {
    ...action,
    positionals,
    flags,
    runtime,
  };
}

function resolveReplayFlags(
  flags: SessionAction['flags'] | undefined,
  scope: ReplayVarScope,
  loc: { file: string; line: number },
): SessionAction['flags'] {
  if (!flags) return {};
  const next: Record<string, unknown> = { ...flags };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string') {
      next[key] = resolveReplayString(value, scope, loc);
    }
  }
  return next as SessionAction['flags'];
}

function resolveReplayRuntime(
  runtime: SessionRuntimeHints | undefined,
  scope: ReplayVarScope,
  loc: { file: string; line: number },
): SessionRuntimeHints | undefined {
  if (!runtime) return undefined;
  const next: Record<string, unknown> = { ...runtime };
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'string') {
      next[key] = resolveReplayString(value, scope, loc);
    }
  }
  return next as SessionRuntimeHints;
}
