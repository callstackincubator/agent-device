import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CommandFlags } from '../core/dispatch.ts';
import type { SessionAction, SessionState } from './types.ts';
import { inferFillText } from './action-utils.ts';

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

  static expandHome(filePath: string): string {
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
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
      if (selectorChain.length > 0 && (action.command === 'click' || action.command === 'fill' || action.command === 'get')) {
        const selectorExpr = selectorChain.join(' || ');
        if (action.command === 'click') {
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
      if (action.command === 'click' || action.command === 'fill' || action.command === 'get') {
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
    snapshotBackend,
    relaunch,
    saveScript,
    noRecord,
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
    snapshotBackend,
    relaunch,
    saveScript,
    noRecord,
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
  if (action.command === 'click') {
    const ref = action.positionals?.[0];
    if (ref) {
      parts.push(formatArg(ref));
      if (ref.startsWith('@')) {
        const refLabel = action.result?.refLabel;
        if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
          parts.push(formatArg(refLabel));
        }
      }
      return parts.join(' ');
    }
  }
  if (action.command === 'fill') {
    const ref = action.positionals?.[0];
    if (ref && ref.startsWith('@')) {
      parts.push(formatArg(ref));
      const refLabel = action.result?.refLabel;
      const text = action.positionals.slice(1).join(' ');
      if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
        parts.push(formatArg(refLabel));
      }
      if (text) {
        parts.push(formatArg(text));
      }
      return parts.join(' ');
    }
  }
  if (action.command === 'get') {
    const sub = action.positionals?.[0];
    const ref = action.positionals?.[1];
    if (sub && ref) {
      parts.push(formatArg(sub));
      parts.push(formatArg(ref));
      if (ref.startsWith('@')) {
        const refLabel = action.result?.refLabel;
        if (typeof refLabel === 'string' && refLabel.trim().length > 0) {
          parts.push(formatArg(refLabel));
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
      parts.push('-s', formatArg(action.flags.snapshotScope));
    }
    if (action.flags?.snapshotRaw) parts.push('--raw');
    if (action.flags?.snapshotBackend) {
      parts.push(`--backend`, action.flags.snapshotBackend);
    }
    return parts.join(' ');
  }
  if (action.command === 'open') {
    for (const positional of action.positionals ?? []) {
      parts.push(formatArg(positional));
    }
    if (action.flags?.relaunch) {
      parts.push('--relaunch');
    }
    return parts.join(' ');
  }
  for (const positional of action.positionals ?? []) {
    parts.push(formatArg(positional));
  }
  return parts.join(' ');
}

function formatArg(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('@')) return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  return JSON.stringify(trimmed);
}
