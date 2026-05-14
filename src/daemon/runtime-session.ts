import type { CommandSessionRecord, CommandSessionStore } from '../runtime-contract.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import type { SessionState } from './types.ts';

export type RuntimeSessionRecordOptions = {
  includeSnapshot?: boolean;
  metadata?: Record<string, unknown>;
};

export function toRuntimeSessionRecord(
  session: SessionState | undefined,
  name: string,
  options: RuntimeSessionRecordOptions = {},
): CommandSessionRecord | undefined {
  if (!session) return undefined;
  return {
    name,
    appBundleId: session.appBundleId,
    appName: session.appName,
    ...(options.includeSnapshot === true ? { snapshot: session.snapshot } : {}),
    metadata: {
      surface: session.surface,
      ...(options.metadata ?? {}),
    },
  };
}

export function createDaemonRuntimeSessionStore(params: {
  sessionName: string;
  getSession: () => SessionState | undefined;
  recordOptions?: RuntimeSessionRecordOptions;
  setRecord: (record: CommandSessionRecord) => void;
}): CommandSessionStore {
  return {
    get: (name) =>
      name === params.sessionName
        ? toRuntimeSessionRecord(params.getSession(), params.sessionName, params.recordOptions)
        : undefined,
    set: (record) => {
      if (record.name !== params.sessionName) {
        emitDiagnostic({
          level: 'warn',
          phase: 'runtime_session_write_skipped',
          data: { expected: params.sessionName, received: record.name },
        });
        return;
      }
      params.setRecord(record);
    },
  };
}
