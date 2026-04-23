import fs from 'node:fs';
import { AppError } from '../../utils/errors.ts';
import type { PlatformSelector } from '../../utils/device.ts';
import { appendOpenActionScriptArgs, parseReplayOpenFlags } from '../session-open-script.ts';
import type { SessionAction, SessionState } from '../types.ts';
import {
  appendRecordActionScriptArgs,
  appendRuntimeHintFlags,
  appendScriptSeriesFlags,
  formatScriptArgQuoteIfNeeded,
  formatScriptArg,
  formatScriptStringLiteral,
  isClickLikeCommand,
  parseReplaySeriesFlags,
  parseReplayRuntimeFlags,
} from '../script-utils.ts';

type ReplayScriptPlatform = Exclude<PlatformSelector, 'apple'>;

const REPLAY_METADATA_PLATFORMS = new Set<ReplayScriptPlatform>([
  'ios',
  'android',
  'macos',
  'linux',
]);

export type ReplayScriptMetadata = {
  platform?: ReplayScriptPlatform;
  timeoutMs?: number;
  retries?: number;
  env?: Record<string, string>;
};

const REPLAY_ENV_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;

export function parseReplayScript(script: string): SessionAction[] {
  return parseReplayScriptDetailed(script).actions;
}

export type ParsedReplayScript = {
  actions: SessionAction[];
  actionLines: number[];
};

export function parseReplayScriptDetailed(script: string): ParsedReplayScript {
  const actions: SessionAction[] = [];
  const actionLines: number[] = [];
  const lines = script.split(/\r?\n/);
  let sawAction = false;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const trimmed = rawLine.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (isReplayEnvLine(trimmed)) {
      if (sawAction) {
        throw new AppError(
          'INVALID_ARGS',
          `env directives must precede all actions (line ${index + 1}).`,
        );
      }
      continue;
    }
    const parsed = parseReplayScriptLine(rawLine);
    if (!parsed) continue;
    actions.push(parsed);
    actionLines.push(index + 1);
    sawAction = true;
  }
  return { actions, actionLines };
}

export function readReplayScriptMetadata(script: string): ReplayScriptMetadata {
  const lines = script.split(/\r?\n/);
  const metadata: ReplayScriptMetadata = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;
    if (isReplayEnvLine(trimmed)) {
      ingestEnvLine(metadata, trimmed, index + 1);
      continue;
    }
    if (!trimmed.startsWith('context ')) break;
    const platformMatch = trimmed.match(/(?:^|\s)platform=([^\s]+)/);
    if (platformMatch) {
      const platform = platformMatch[1] as ReplayScriptPlatform | undefined;
      if (platform && REPLAY_METADATA_PLATFORMS.has(platform)) {
        assignReplayMetadataValue(metadata, 'platform', platform);
      }
    }
    const timeoutMatch = trimmed.match(/(?:^|\s)timeout=(\d+)/);
    if (timeoutMatch) {
      const timeoutMs = Number(timeoutMatch[1]);
      if (Number.isFinite(timeoutMs) && timeoutMs >= 1) {
        assignReplayMetadataValue(metadata, 'timeoutMs', Math.floor(timeoutMs));
      }
    }
    const retriesMatch = trimmed.match(/(?:^|\s)retries=(\d+)/);
    if (retriesMatch) {
      const retries = Number(retriesMatch[1]);
      if (Number.isFinite(retries) && retries >= 0) {
        assignReplayMetadataValue(metadata, 'retries', Math.floor(retries));
      }
    }
  }
  return metadata;
}

function isReplayEnvLine(trimmed: string): boolean {
  return trimmed === 'env' || trimmed.startsWith('env ') || trimmed.startsWith('env\t');
}

export function parseReplayEnvLine(trimmed: string, lineNumber: number): { key: string; value: string } {
  const body = trimmed.slice(3).replace(/^[\s]+/, '');
  const eqIndex = body.indexOf('=');
  if (eqIndex <= 0) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid env directive on line ${lineNumber}: expected "env KEY=VALUE".`,
    );
  }
  const key = body.slice(0, eqIndex);
  if (!REPLAY_ENV_KEY_RE.test(key)) {
    throw new AppError(
      'INVALID_ARGS',
      `Invalid env key "${key}" on line ${lineNumber}: must match /^[A-Z_][A-Z0-9_]*$/.`,
    );
  }
  const rawValue = body.slice(eqIndex + 1);
  const value = decodeReplayEnvValue(rawValue, lineNumber);
  return { key, value };
}

function decodeReplayEnvValue(raw: string, lineNumber: number): string {
  if (raw.length === 0) return '';
  if (raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'string') {
        throw new Error('not a string literal');
      }
      return parsed;
    } catch {
      throw new AppError(
        'INVALID_ARGS',
        `Invalid quoted env value on line ${lineNumber}.`,
      );
    }
  }
  return raw;
}

function ingestEnvLine(metadata: ReplayScriptMetadata, trimmed: string, lineNumber: number): void {
  const { key, value } = parseReplayEnvLine(trimmed, lineNumber);
  const env = metadata.env ?? {};
  if (Object.prototype.hasOwnProperty.call(env, key)) {
    throw new AppError(
      'INVALID_ARGS',
      `Duplicate env directive "${key}" on line ${lineNumber}.`,
    );
  }
  env[key] = value;
  metadata.env = env;
}

function assignReplayMetadataValue<Key extends keyof ReplayScriptMetadata>(
  metadata: ReplayScriptMetadata,
  key: Key,
  value: NonNullable<ReplayScriptMetadata[Key]>,
): void {
  const previous = metadata[key];
  if (previous !== undefined) {
    const duplicateMessage =
      previous === value
        ? `Duplicate replay test metadata "${key}" in context header.`
        : `Conflicting replay test metadata "${key}" in context header: ${String(previous)} vs ${String(value)}.`;
    throw new AppError('INVALID_ARGS', duplicateMessage);
  }
  metadata[key] = value as ReplayScriptMetadata[Key];
}

function parseReplayScriptLine(line: string): SessionAction | null {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.startsWith('#')) return null;
  const tokens = tokenizeReplayLine(trimmed);
  if (tokens.length === 0) return null;
  const [command, ...args] = tokens;
  if (command === 'context') return null;

  const action: SessionAction = {
    ts: Date.now(),
    command,
    positionals: [],
    flags: {},
  };

  if (command === 'snapshot') {
    action.positionals = [];
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === '-i') {
        action.flags.snapshotInteractiveOnly = true;
        continue;
      }
      if (token === '-c') {
        action.flags.snapshotCompact = true;
        continue;
      }
      if (token === '--raw') {
        action.flags.snapshotRaw = true;
        continue;
      }
      if ((token === '-d' || token === '--depth') && index + 1 < args.length) {
        const parsedDepth = Number(args[index + 1]);
        if (Number.isFinite(parsedDepth) && parsedDepth >= 0) {
          action.flags.snapshotDepth = Math.floor(parsedDepth);
        }
        index += 1;
        continue;
      }
      if ((token === '-s' || token === '--scope') && index + 1 < args.length) {
        action.flags.snapshotScope = args[index + 1];
        index += 1;
        continue;
      }
      if (token === '--backend' && index + 1 < args.length) {
        // Backward compatibility: ignore legacy snapshot backend token.
        index += 1;
        continue;
      }
    }
    return action;
  }

  if (command === 'open') {
    const parsed = parseReplayOpenFlags(args);
    action.positionals = parsed.positionals;
    Object.assign(action.flags, parsed.flags);
    action.runtime = parsed.runtime;
    return action;
  }

  if (command === 'runtime') {
    const parsed = parseReplayRuntimeFlags(args);
    action.positionals = parsed.positionals;
    Object.assign(action.flags, parsed.flags);
    return action;
  }

  if (isClickLikeCommand(command)) {
    const parsed = parseReplaySeriesFlags(command, args);
    Object.assign(action.flags, parsed.flags);
    if (parsed.positionals.length === 0) return action;
    const target = parsed.positionals[0];
    if (target.startsWith('@')) {
      action.positionals = [target];
      if (parsed.positionals[1]) {
        action.result = { refLabel: parsed.positionals[1] };
      }
      return action;
    }
    const maybeX = parsed.positionals[0];
    const maybeY = parsed.positionals[1];
    if (isNumericToken(maybeX) && isNumericToken(maybeY) && parsed.positionals.length >= 2) {
      action.positionals = [maybeX, maybeY];
      return action;
    }
    action.positionals = [parsed.positionals.join(' ')];
    return action;
  }

  if (command === 'fill') {
    const parsed = parseReplaySeriesFlags(command, args);
    Object.assign(action.flags, parsed.flags);
    if (parsed.positionals.length < 2) {
      action.positionals = parsed.positionals;
      return action;
    }
    const target = parsed.positionals[0];
    if (target.startsWith('@')) {
      if (parsed.positionals.length >= 3) {
        action.positionals = [target, parsed.positionals.slice(2).join(' ')];
        action.result = { refLabel: parsed.positionals[1] };
        return action;
      }
      action.positionals = [target, parsed.positionals[1]];
      return action;
    }
    action.positionals = [target, parsed.positionals.slice(1).join(' ')];
    return action;
  }

  if (command === 'get') {
    if (args.length < 2) {
      action.positionals = args;
      return action;
    }
    const sub = args[0];
    const target = args[1];
    if (target.startsWith('@')) {
      action.positionals = [sub, target];
      if (args[2]) {
        action.result = { refLabel: args[2] };
      }
      return action;
    }
    action.positionals = [sub, args.slice(1).join(' ')];
    return action;
  }

  if (command === 'swipe' || command === 'type') {
    const parsed = parseReplaySeriesFlags(command, args);
    Object.assign(action.flags, parsed.flags);
    action.positionals = parsed.positionals;
    return action;
  }

  if (command === 'record') {
    const positionals: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === '--hide-touches') {
        action.flags.hideTouches = true;
        continue;
      }
      if (token === '--fps' && index + 1 < args.length) {
        const parsedFps = Number(args[index + 1]);
        if (Number.isFinite(parsedFps)) {
          action.flags.fps = Math.floor(parsedFps);
        }
        index += 1;
        continue;
      }
      if (token === '--quality' && index + 1 < args.length) {
        const parsedQuality = Number(args[index + 1]);
        if (Number.isFinite(parsedQuality)) {
          action.flags.quality = Math.floor(parsedQuality);
        }
        index += 1;
        continue;
      }
      positionals.push(token);
    }
    action.positionals = positionals;
    return action;
  }

  if (command === 'screenshot') {
    const positionals: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const token = args[index];
      if (token === '--fullscreen') {
        action.flags.screenshotFullscreen = true;
        continue;
      }
      if (token === '--max-size') {
        const value = args[index + 1];
        const maxSize = value === undefined ? NaN : Number(value);
        if (!Number.isInteger(maxSize) || maxSize < 1) {
          throw new AppError('INVALID_ARGS', 'screenshot --max-size requires a positive integer');
        }
        action.flags.screenshotMaxSize = maxSize;
        index += 1;
        continue;
      }
      positionals.push(token);
    }
    action.positionals = positionals;
    return action;
  }

  action.positionals = args;
  return action;
}

function isNumericToken(token: string | undefined): token is string {
  if (!token) return false;
  return !Number.isNaN(Number(token));
}

function tokenizeReplayLine(line: string): string[] {
  const tokens: string[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (cursor < line.length && /\s/.test(line[cursor])) {
      cursor += 1;
    }
    if (cursor >= line.length) break;
    if (line[cursor] === '"') {
      let end = cursor + 1;
      let escaped = false;
      while (end < line.length) {
        const char = line[end];
        if (char === '"' && !escaped) break;
        escaped = char === '\\' && !escaped;
        if (char !== '\\') escaped = false;
        end += 1;
      }
      if (end >= line.length) {
        throw new AppError('INVALID_ARGS', `Invalid replay script line: ${line}`);
      }
      const literal = line.slice(cursor, end + 1);
      tokens.push(JSON.parse(literal) as string);
      cursor = end + 1;
      continue;
    }
    let end = cursor;
    while (end < line.length && !/\s/.test(line[end])) {
      end += 1;
    }
    tokens.push(line.slice(cursor, end));
    cursor = end;
  }
  return tokens;
}

export function writeReplayScript(
  filePath: string,
  actions: SessionAction[],
  session?: SessionState,
) {
  const lines: string[] = [];
  // Session can be missing if the replay session is closed/deleted between execution and update write.
  // In that case we still persist healed actions and omit only the context header.
  if (session) {
    const kind = session.device.kind ? ` kind=${session.device.kind}` : '';
    const target = session.device.target ? ` target=${session.device.target}` : '';
    lines.push(
      `context platform=${session.device.platform}${target} device=${formatScriptStringLiteral(session.device.name)}${kind} theme=unknown`,
    );
  }
  for (const action of actions) {
    lines.push(formatReplayActionLine(action));
  }
  const serialized = `${lines.join('\n')}\n`;
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmpPath, serialized);
  fs.renameSync(tmpPath, filePath);
}

function formatReplayActionLine(action: SessionAction): string {
  const parts: string[] = [action.command];
  if (action.command === 'snapshot') {
    if (action.flags?.snapshotInteractiveOnly) parts.push('-i');
    if (action.flags?.snapshotCompact) parts.push('-c');
    if (typeof action.flags?.snapshotDepth === 'number') {
      parts.push('-d', String(action.flags.snapshotDepth));
    }
    if (action.flags?.snapshotScope) {
      parts.push('-s', formatScriptArg(action.flags.snapshotScope));
    }
    if (action.flags?.snapshotRaw) parts.push('--raw');
    return parts.join(' ');
  }
  if (action.command === 'open') {
    appendOpenActionScriptArgs(parts, action);
    return parts.join(' ');
  }
  if (action.command === 'runtime') {
    for (const positional of action.positionals ?? []) {
      parts.push(formatScriptArgQuoteIfNeeded(positional));
    }
    appendRuntimeHintFlags(parts, action.flags);
    return parts.join(' ');
  }
  if (action.command === 'record') {
    appendRecordActionScriptArgs(parts, action);
    return parts.join(' ');
  }
  if (action.command === 'screenshot') {
    for (const positional of action.positionals ?? []) {
      parts.push(formatScriptArg(positional));
    }
    if (action.flags?.screenshotFullscreen) parts.push('--fullscreen');
    if (typeof action.flags?.screenshotMaxSize === 'number') {
      parts.push('--max-size', String(action.flags.screenshotMaxSize));
    }
    return parts.join(' ');
  }
  for (const positional of action.positionals ?? []) {
    parts.push(formatScriptArg(positional));
  }
  appendScriptSeriesFlags(parts, action);
  return parts.join(' ');
}
