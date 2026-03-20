import fs from 'node:fs';
import path from 'node:path';
import type { CommandFlags } from '../../core/dispatch.ts';
import type { DaemonRequest, DaemonResponse } from '../types.ts';
import { SessionStore } from '../session-store.ts';
import { handleRecordCommand, type RecordTraceDeps } from './record-trace-recording.ts';

export async function handleRecordTraceCommands(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  logPath?: string;
  deps?: Partial<RecordTraceDeps>;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, sessionStore, logPath } = params;
  const command = req.command;

  if (command === 'record') {
    return handleRecordCommand({ req, sessionName, sessionStore, logPath, deps: params.deps });
  }

  if (command === 'trace') {
    const action = (req.positionals?.[0] ?? '').toLowerCase();
    if (!['start', 'stop'].includes(action)) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'trace requires start|stop' } };
    }
    const session = sessionStore.get(sessionName);
    if (!session) {
      return { ok: false, error: { code: 'SESSION_NOT_FOUND', message: 'No active session' } };
    }
    if (action === 'start') {
      if (session.trace) {
        return { ok: false, error: { code: 'INVALID_ARGS', message: 'trace already in progress' } };
      }
      const outPath = req.positionals?.[1] ?? sessionStore.defaultTracePath(session);
      const resolvedOut = SessionStore.expandHome(outPath);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      fs.appendFileSync(resolvedOut, '');
      session.trace = { outPath: resolvedOut, startedAt: Date.now() };
      sessionStore.recordAction(session, {
        command,
        positionals: req.positionals ?? [],
        flags: (req.flags ?? {}) as CommandFlags,
        result: { action: 'start', outPath: resolvedOut },
      });
      return { ok: true, data: { trace: 'started', outPath: resolvedOut } };
    }
    if (!session.trace) {
      return { ok: false, error: { code: 'INVALID_ARGS', message: 'no active trace' } };
    }
    let outPath = session.trace.outPath;
    if (req.positionals?.[1]) {
      const resolvedOut = SessionStore.expandHome(req.positionals[1]);
      fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
      if (fs.existsSync(outPath)) {
        fs.renameSync(outPath, resolvedOut);
      } else {
        fs.appendFileSync(resolvedOut, '');
      }
      outPath = resolvedOut;
    }
    session.trace = undefined;
    sessionStore.recordAction(session, {
      command,
      positionals: req.positionals ?? [],
      flags: (req.flags ?? {}) as CommandFlags,
      result: { action: 'stop', outPath },
    });
    return { ok: true, data: { trace: 'stopped', outPath } };
  }

  return null;
}
