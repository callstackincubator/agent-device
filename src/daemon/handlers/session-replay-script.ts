import fs from 'node:fs';
import { AppError } from '../../utils/errors.ts';
import { appendOpenActionScriptArgs, parseReplayOpenFlags } from '../session-open-script.ts';
import { appendRecordActionScriptArgs } from '../session-record-script.ts';
import type { SessionAction, SessionState } from '../types.ts';
import {
  appendRuntimeHintFlags,
  appendScriptSeriesFlags,
  formatScriptArgQuoteIfNeeded,
  formatScriptArg,
  isClickLikeCommand,
  parseReplaySeriesFlags,
  parseReplayRuntimeFlags,
} from '../script-utils.ts';

export function parseReplayScript(script: string): SessionAction[] {
  const actions: SessionAction[] = [];
  const lines = script.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseReplayScriptLine(line);
    if (parsed) {
      actions.push(parsed);
    }
  }
  return actions;
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
    if (args.length < 2) {
      action.positionals = args;
      return action;
    }
    const target = args[0];
    if (target.startsWith('@')) {
      if (args.length >= 3) {
        action.positionals = [target, args.slice(2).join(' ')];
        action.result = { refLabel: args[1] };
        return action;
      }
      action.positionals = [target, args[1]];
      return action;
    }
    action.positionals = [target, args.slice(1).join(' ')];
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

  if (command === 'swipe') {
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
    const deviceLabel = session.device.name.replace(/"/g, '\\"');
    const kind = session.device.kind ? ` kind=${session.device.kind}` : '';
    const target = session.device.target ? ` target=${session.device.target}` : '';
    lines.push(
      `context platform=${session.device.platform}${target} device="${deviceLabel}"${kind} theme=unknown`,
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
  for (const positional of action.positionals ?? []) {
    parts.push(formatScriptArg(positional));
  }
  appendScriptSeriesFlags(parts, action);
  return parts.join(' ');
}
