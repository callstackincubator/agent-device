import type { AgentDeviceBackend, BackendSnapshotResult } from '../backend.ts';
import type { CommandSessionRecord } from '../runtime.ts';
import { createAgentDevice, localCommandPolicy } from '../runtime.ts';
import { isCommandSupportedOnDevice } from '../core/capabilities.ts';
import { AppError } from '../utils/errors.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from './types.ts';
import { SessionStore } from './session-store.ts';
import { errorResponse } from './handlers/response.ts';
import { createUnsupportedArtifactAdapter } from './runtime-artifacts.ts';
import { captureSnapshot, resolveSnapshotScope } from './handlers/snapshot-capture.ts';
import {
  buildSnapshotSession,
  resolveSessionDevice,
  withSessionlessRunnerCleanup,
} from './handlers/snapshot-session.ts';

export async function dispatchSnapshotViaRuntime(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;
  const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
  if (!isCommandSupportedOnDevice('snapshot', device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'snapshot is not supported on this device');
  }
  const resolvedScope = resolveSnapshotScope(req.flags?.snapshotScope, session);
  if (!resolvedScope.ok) return resolvedScope;

  return await withSessionlessRunnerCleanup(session, device, async () => {
    const runtime = createSnapshotRuntime({
      req,
      sessionName,
      logPath,
      sessionStore,
      session,
      device,
      snapshotScope: resolvedScope.scope,
    });
    const result = await runtime.capture.snapshot({
      session: sessionName,
      interactiveOnly: req.flags?.snapshotInteractiveOnly,
      compact: req.flags?.snapshotCompact,
      depth: req.flags?.snapshotDepth,
      scope: resolvedScope.scope,
      raw: req.flags?.snapshotRaw,
    });
    recordSnapshotRuntimeAction({
      req,
      sessionName,
      sessionStore,
      result: {
        nodes: result.nodes.length,
        truncated: result.truncated,
      },
    });
    return {
      ok: true,
      data: result,
    };
  });
}

export async function dispatchSnapshotDiffViaRuntime(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;
  const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
  if (!isCommandSupportedOnDevice('diff', device)) {
    return errorResponse('UNSUPPORTED_OPERATION', 'diff is not supported on this device');
  }
  const resolvedScope = resolveSnapshotScope(req.flags?.snapshotScope, session);
  if (!resolvedScope.ok) return resolvedScope;

  return await withSessionlessRunnerCleanup(session, device, async () => {
    const runtime = createSnapshotRuntime({
      req,
      sessionName,
      logPath,
      sessionStore,
      session,
      device,
      snapshotScope: resolvedScope.scope,
    });
    const result = await runtime.capture.diffSnapshot({
      session: sessionName,
      interactiveOnly: req.flags?.snapshotInteractiveOnly,
      compact: req.flags?.snapshotCompact,
      depth: req.flags?.snapshotDepth,
      scope: resolvedScope.scope,
      raw: req.flags?.snapshotRaw,
    });
    recordSnapshotRuntimeAction({
      req,
      sessionName,
      sessionStore,
      result: {
        mode: 'snapshot',
        baselineInitialized: result.baselineInitialized,
        summary: result.summary,
      },
    });
    return {
      ok: true,
      data: result,
    };
  });
}

function createSnapshotRuntime(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  session: SessionState | undefined;
  device: SessionState['device'];
  snapshotScope: string | undefined;
}) {
  const { req, sessionName, logPath, sessionStore, session, device, snapshotScope } = params;
  return createAgentDevice({
    backend: createDaemonSnapshotBackend({
      req,
      logPath,
      session,
      device,
      snapshotScope,
    }),
    artifacts: createUnsupportedArtifactAdapter('snapshot'),
    sessions: {
      get: (name) =>
        name === sessionName ? toCommandSessionRecord(sessionStore.get(sessionName)) : undefined,
      set: (record) => {
        if (!record.snapshot) {
          throw new AppError('UNKNOWN', 'snapshot runtime did not produce session state');
        }
        const current = sessionStore.get(sessionName);
        sessionStore.set(
          sessionName,
          buildNextSnapshotSession({
            current,
            sessionName,
            device,
            record,
            refScopedSnapshot: isRefScopedSnapshot(req),
          }),
        );
      },
    },
    policy: localCommandPolicy(),
  });
}

function buildNextSnapshotSession(params: {
  current: SessionState | undefined;
  sessionName: string;
  device: SessionState['device'];
  record: CommandSessionRecord;
  refScopedSnapshot: boolean;
}): SessionState {
  const { current, sessionName, device, record, refScopedSnapshot } = params;
  if (!record.snapshot) {
    throw new AppError('UNKNOWN', 'snapshot runtime did not produce session state');
  }
  const keepCurrentSnapshot = shouldKeepCurrentSnapshot(current, record, refScopedSnapshot);
  const snapshot = keepCurrentSnapshot ? current.snapshot : record.snapshot;
  const nextSession = buildSnapshotSession({
    session: current,
    sessionName,
    device,
    snapshot,
    appBundleId: record.appBundleId,
  });
  nextSession.snapshotScopeSource = resolveNextSnapshotScopeSource({
    current,
    keepCurrentSnapshot,
    refScopedSnapshot,
  });
  if (record.appName) nextSession.appName = record.appName;
  return nextSession;
}

function isRefScopedSnapshot(req: DaemonRequest): boolean {
  return req.flags?.snapshotScope?.trim().startsWith('@') === true;
}

function shouldKeepCurrentSnapshot(
  current: SessionState | undefined,
  record: CommandSessionRecord,
  refScopedSnapshot: boolean,
): current is SessionState & { snapshot: NonNullable<SessionState['snapshot']> } {
  return (
    refScopedSnapshot && record.snapshot?.nodes.length === 0 && current?.snapshot !== undefined
  );
}

function resolveNextSnapshotScopeSource(params: {
  current: SessionState | undefined;
  keepCurrentSnapshot: boolean;
  refScopedSnapshot: boolean;
}): SessionState['snapshotScopeSource'] {
  const { current, keepCurrentSnapshot, refScopedSnapshot } = params;
  if (!refScopedSnapshot) return undefined;
  if (keepCurrentSnapshot) return current?.snapshotScopeSource;
  return current?.snapshotScopeSource ?? current?.snapshot;
}

function createDaemonSnapshotBackend(params: {
  req: DaemonRequest;
  logPath: string;
  session: SessionState | undefined;
  device: SessionState['device'];
  snapshotScope: string | undefined;
}): AgentDeviceBackend {
  const { req, logPath, session, device, snapshotScope } = params;
  return {
    platform: device.platform,
    captureSnapshot: async (_context, options): Promise<BackendSnapshotResult> => {
      const capture = await captureSnapshot({
        device,
        session,
        flags: req.flags,
        outPath: options?.outPath ?? req.flags?.out,
        logPath,
        snapshotScope,
      });
      return {
        snapshot: capture.snapshot,
        analysis: capture.analysis,
        androidSnapshot: capture.androidSnapshot,
        freshness: capture.freshness,
        appName: session?.appBundleId ? (session.appName ?? session.appBundleId) : undefined,
        appBundleId: session?.appBundleId,
      };
    },
  };
}

function toCommandSessionRecord(
  session: SessionState | undefined,
): CommandSessionRecord | undefined {
  if (!session) return undefined;
  return {
    name: session.name,
    appBundleId: session.appBundleId,
    appName: session.appName,
    snapshot: session.snapshot,
    metadata: {
      surface: session.surface,
    },
  };
}

function recordSnapshotRuntimeAction(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  result: Record<string, unknown>;
}): void {
  const session = params.sessionStore.get(params.sessionName);
  if (!session) return;
  params.sessionStore.recordAction(session, {
    command: params.req.command,
    positionals: params.req.positionals ?? [],
    flags: params.req.flags ?? {},
    result: params.result,
  });
}
