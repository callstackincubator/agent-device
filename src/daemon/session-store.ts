import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionAction, SessionState } from './types.ts';
import { inferFillText } from './action-utils.ts';
import { appendScriptSeriesFlags, formatScriptArg, isClickLikeCommand } from './script-utils.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
  }

  get(name: string): SessionState | undefined {
    return this.sessions.get(name);
  }

  has(name: string): boolean {
    return this.sessions.has(name);
  }

  set(name: string, session: SessionState): void {
    this.sessions.set(name, session);
  }

  delete(name: string): boolean {
    return this.sessions.delete(name);
  }

  values(): IterableIterator<SessionState> {
    return this.sessions.values();
  }

  toArray(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  recordAction(
    session: SessionState,
    entry: {
      command: string;
      positionals: string[];
      flags: CommandFlags;
      result?: Record<string, unknown>;
    },
  ): void {
    if (entry.flags?.noRecord) return;
    if (entry.flags?.saveScript) {
      session.recordSession = true;
      if (typeof entry.flags.saveScript === 'string') {
        session.saveScriptPath = SessionStore.expandHome(entry.flags.saveScript);
      }
    }
    session.actions.push({
      ts: Date.now(),
      command: entry.command,
      positionals: entry.positionals,
      flags: sanitizeFlags(entry.flags),
      result: entry.result,
    });
    emitDiagnostic({
      level: 'debug',
      phase: 'record_action',
      data: {
        command: entry.command,
        session: session.name,
      },
    });
  }

  writeSessionLog(session: SessionState): void {
    try {
      if (!session.recordSession) return;
      const scriptPath = this.resolveScriptPath(session);
      const scriptDir = path.dirname(scriptPath);
      if (!fs.existsSync(scriptDir)) fs.mkdirSync(scriptDir, { recursive: true });
      const script = formatScript(session, this.buildOptimizedActions(session));
      fs.writeFileSync(scriptPath, script);
    } catch {
      // ignore
    }
  }

  defaultTracePath(session: SessionState): string {
    const safeName = session.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.sessionsDir, `${safeName}-${timestamp}.trace.log`);
  }

  static expandHome(filePath: string, cwd?: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    if (cwd && !path.isAbsolute(filePath)) {
      return path.resolve(cwd, filePath);
    }
    return path.resolve(filePath);
  }

  private resolveScriptPath(session: SessionState): string {
    if (session.saveScriptPath) {
      return SessionStore.expandHome(session.saveScriptPath);
    }
    if (!fs.existsSync(this.sessionsDir)) fs.mkdirSync(this.sessionsDir, { recursive: true });
    const safeName = session.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const timestamp = new Date(session.createdAt).toISOString().replace(/[:.]/g, '-');
    return path.join(this.sessionsDir, `${safeName}-${timestamp}.ad`);
  }

  private buildOptimizedActions(session: SessionState): SessionAction[] {
    const optimized: SessionAction[] = [];
    for (const action of session.actions) {
      if (action.command === 'snapshot') {
        continue;
      }
      const selectorChain =
        Array.isArray(action.result?.selectorChain) &&
        action.result?.selectorChain.every((entry) => typeof entry === 'string')
          ? (action.result.selectorChain as string[])
          : [];
      if (
        selectorChain.length > 0 &&
        (isClickLikeCommand(action.command) || action.command === 'fill' || action.command === 'get')
      ) {
        const selectorExpr = selectorChain.join(' || ');
        if (isClickLikeCommand(action.command)) {
          optimized.push({
            ...action,
            positionals: [selectorExpr],
          });
          continue;
        }
        if (action.command === 'fill') {
          const text = inferFillText(action);
          if (text.length > 0) {
            optimized.push({
              ...action,
              positionals: [selectorExpr, text],
            });
            continue;
          }
        }
        if (action.command === 'get') {
          const sub = action.positionals?.[0];
          if (sub === 'text' || sub === 'attrs') {
            optimized.push({
              ...action,
              positionals: [sub, selectorExpr],
            });
            continue;
          }
        }
      }
      if (isClickLikeCommand(action.command) || action.command === 'fill' || action.command === 'get') {
        const refLabel = action.result?.refLabel;
        if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
          optimized.push({
            ts: action.ts,
            command: 'snapshot',
            positionals: [],
            flags: {
              platform: session.device.platform,
              snapshotInteractiveOnly: true,
              snapshotCompact: true,
              snapshotScope: refLabel.trim(),
            },
            result: { scope: refLabel.trim() },
          });
        }
      }
      optimized.push(action);
    }
    return optimized;
  }
}

function sanitizeFlags(flags: CommandFlags | undefined): SessionAction['flags'] {
  if (!flags) return {};
  const {
    platform,
    device,
    udid,
    serial,
    out,
    verbose,
    snapshotInteractiveOnly,
    snapshotCompact,
    snapshotDepth,
    snapshotScope,
    snapshotRaw,
    relaunch,
    saveScript,
    noRecord,
    count,
    intervalMs,
    holdMs,
    jitterPx,
    doubleTap,
    pauseMs,
    pattern,
  } = flags;
  return {
    platform,
    device,
    udid,
    serial,
    out,
    verbose,
    snapshotInteractiveOnly,
    snapshotCompact,
    snapshotDepth,
    snapshotScope,
    snapshotRaw,
    relaunch,
    saveScript,
    noRecord,
    count,
    intervalMs,
    holdMs,
    jitterPx,
    doubleTap,
    pauseMs,
    pattern,
  };
}

function formatScript(session: SessionState, actions: SessionAction[]): string {
  const lines: string[] = [];
  const deviceLabel = session.device.name.replace(/"/g, '\\"');
  const kind = session.device.kind ? ` kind=${session.device.kind}` : '';
  const theme = 'unknown';
  lines.push(`context platform=${session.device.platform} device="${deviceLabel}"${kind} theme=${theme}`);
  for (const action of actions) {
    if (action.flags?.noRecord) continue;
    lines.push(formatActionLine(action));
  }
  return `${lines.join('\n')}\n`;
}

function formatActionLine(action: SessionAction): string {
  const parts: string[] = [action.command];
  if (isClickLikeCommand(action.command)) {
    const first = action.positionals?.[0];
    if (first) {
      if (first.startsWith('@')) {
        parts.push(formatScriptArg(first));
        const refLabel = action.result?.refLabel;
        if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
          parts.push(formatScriptArg(refLabel));
        }
        appendScriptSeriesFlags(parts, action);
        return parts.join(' ');
      }
      if (action.positionals.length === 1) {
        parts.push(formatScriptArg(first));
        appendScriptSeriesFlags(parts, action);
        return parts.join(' ');
      }
    }
  }
  if (action.command === 'fill') {
    const ref = action.positionals?.[0];
    if (ref && ref.startsWith('@')) {
      parts.push(formatScriptArg(ref));
      const refLabel = action.result?.refLabel;
      const text = action.positionals.slice(1).join(' ');
      if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
        parts.push(formatScriptArg(refLabel));
      }
      if (text) {
        parts.push(formatScriptArg(text));
      }
      return parts.join(' ');
    }
  }
  if (action.command === 'get') {
    const sub = action.positionals?.[0];
    const ref = action.positionals?.[1];
    if (sub && ref) {
      parts.push(formatScriptArg(sub));
      parts.push(formatScriptArg(ref));
      if (ref.startsWith('@')) {
        const refLabel = action.result?.refLabel;
        if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
          parts.push(formatScriptArg(refLabel));
        }
      }
      return parts.join(' ');
    }
  }
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
    for (const positional of action.positionals ?? []) {
      parts.push(formatScriptArg(positional));
    }
    if (action.flags?.relaunch) {
      parts.push('--relaunch');
    }
    return parts.join(' ');
  }
  for (const positional of action.positionals ?? []) {
    parts.push(formatScriptArg(positional));
  }
  appendScriptSeriesFlags(parts, action);
  return parts.join(' ');
}
