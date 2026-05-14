import path from 'node:path';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import type { SessionRuntimeHints, SessionState } from './types.ts';
import { recordActionEntry, type RecordActionEntry } from './session-action-recorder.ts';
import { expandSessionPath, safeSessionName } from './session-paths.ts';
import { SessionScriptWriter } from './session-script-writer.ts';

export class SessionStore {
  private readonly sessions = new Map<string, SessionState>();
  private readonly runtimeHints = new Map<string, SessionRuntimeHints>();
  private readonly sessionsDir: string;
  private readonly scriptWriter: SessionScriptWriter;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    this.scriptWriter = new SessionScriptWriter(sessionsDir);
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
    this.runtimeHints.delete(name);
    return this.sessions.delete(name);
  }

  values(): IterableIterator<SessionState> {
    return this.sessions.values();
  }

  toArray(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  getRuntimeHints(name: string): SessionRuntimeHints | undefined {
    return this.runtimeHints.get(name);
  }

  setRuntimeHints(name: string, hints: SessionRuntimeHints): void {
    this.runtimeHints.set(name, hints);
  }

  clearRuntimeHints(name: string): boolean {
    return this.runtimeHints.delete(name);
  }

  recordAction(session: SessionState, entry: RecordActionEntry): void {
    recordActionEntry(session, entry);
  }

  writeSessionLog(session: SessionState): void {
    const result = this.scriptWriter.write(session);
    if (result.written) {
      emitDiagnostic({
        level: 'info',
        phase: 'session_script_written',
        data: { session: session.name, path: result.path },
      });
    }
  }

  defaultTracePath(session: SessionState): string {
    const safeName = safeSessionName(session.name);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return path.join(this.sessionsDir, `${safeName}-${timestamp}.trace.log`);
  }

  /** Path to session-scoped app log file. Agent can grep this for token-efficient debugging. */
  resolveAppLogPath(sessionName: string): string {
    return path.join(this.sessionsDir, safeSessionName(sessionName), 'app.log');
  }

  resolveAppLogPidPath(sessionName: string): string {
    return path.join(this.sessionsDir, safeSessionName(sessionName), 'app-log.pid');
  }

  static expandHome(filePath: string, cwd?: string): string {
    return expandSessionPath(filePath, cwd);
  }
}
