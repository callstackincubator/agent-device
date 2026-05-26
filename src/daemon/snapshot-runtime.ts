import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AgentDeviceBackend, BackendSnapshotResult } from '../backend.ts';
import type { CommandSessionRecord } from '../runtime.ts';
import { createAgentDevice } from '../runtime.ts';
import { isCommandSupportedOnDevice } from '../core/capabilities.ts';
import { dispatchCommand } from '../core/dispatch.ts';
import { AppError, normalizeError } from '../utils/errors.ts';
import { emitDiagnostic } from '../utils/diagnostics.ts';
import type { SnapshotDiffSummary } from '../utils/snapshot-diff.ts';
import type { DaemonRequest, DaemonResponse, DaemonResponseData, SessionState } from './types.ts';
import { SessionStore } from './session-store.ts';
import { errorResponse } from './handlers/response.ts';
import { captureSnapshot, resolveSnapshotScope } from './handlers/snapshot-capture.ts';
import {
  buildSnapshotSession,
  resolveSessionDevice,
  withSessionlessRunnerCleanup,
} from './handlers/snapshot-session.ts';
import { contextFromFlags } from './context.ts';
import { createDaemonRuntimePolicy } from './runtime-policy.ts';
import { createDaemonRuntimeSessionStore } from './runtime-session.ts';
import { annotateScreenshotWithRefs } from './screenshot-overlay.ts';

export async function dispatchSnapshotViaRuntime(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  return await dispatchSnapshotRuntimeCommand({
    ...params,
    command: 'snapshot',
    unsupportedMessage: 'snapshot is not supported on this device',
    execute: async ({ runtime, sessionName, req, snapshotScope }) => {
      const result = await runtime.capture.snapshot({
        session: sessionName,
        interactiveOnly: req.flags?.snapshotInteractiveOnly,
        compact: req.flags?.snapshotCompact,
        depth: req.flags?.snapshotDepth,
        scope: snapshotScope,
        raw: req.flags?.snapshotRaw,
        forceFull: req.flags?.snapshotForceFull,
      });
      return {
        data: result,
        record: {
          kind: 'snapshot',
          nodes: result.nodes.length,
          truncated: result.truncated,
        },
      };
    },
  });
}

export async function dispatchSnapshotDiffViaRuntime(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  return await dispatchSnapshotRuntimeCommand({
    ...params,
    command: 'diff',
    unsupportedMessage: 'diff is not supported on this device',
    execute: async ({ runtime, sessionName, req, snapshotScope }) => {
      const result = await runtime.capture.diffSnapshot({
        session: sessionName,
        interactiveOnly: req.flags?.snapshotInteractiveOnly,
        compact: req.flags?.snapshotCompact,
        depth: req.flags?.snapshotDepth,
        scope: snapshotScope,
        raw: req.flags?.snapshotRaw,
      });
      return {
        data: result,
        record: {
          kind: 'diff',
          mode: 'snapshot',
          baselineInitialized: result.baselineInitialized,
          summary: result.summary,
        },
      };
    },
  });
}

type SnapshotRuntimeCommandParams = {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  command: 'snapshot' | 'diff';
  unsupportedMessage: string;
  execute(params: {
    runtime: ReturnType<typeof createSnapshotRuntime>;
    sessionName: string;
    req: DaemonRequest;
    snapshotScope: string | undefined;
  }): Promise<{ data: DaemonResponseData; record: SnapshotRuntimeRecord }>;
};

type SnapshotRuntimeRecord =
  | { kind: 'snapshot'; nodes: number; truncated: boolean | undefined }
  | {
      kind: 'diff';
      mode: 'snapshot';
      baselineInitialized: boolean;
      summary: SnapshotDiffSummary;
    };

async function dispatchSnapshotRuntimeCommand(
  params: SnapshotRuntimeCommandParams,
): Promise<DaemonResponse> {
  const { req, sessionName, logPath, sessionStore } = params;
  const { session, device } = await resolveSessionDevice(sessionStore, sessionName, req.flags);
  if (!isCommandSupportedOnDevice(params.command, device)) {
    return errorResponse('UNSUPPORTED_OPERATION', params.unsupportedMessage);
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
    let result: Awaited<ReturnType<SnapshotRuntimeCommandParams['execute']>>;
    try {
      result = await params.execute({
        runtime,
        sessionName,
        req,
        snapshotScope: resolvedScope.scope,
      });
    } catch (error) {
      const timeoutEvidence = await maybeCaptureAndroidSnapshotTimeoutEvidence({
        error,
        command: params.command,
        logPath,
        session,
        device,
      });
      if (!timeoutEvidence) throw error;
      const normalized = normalizeError(error);
      return {
        ok: false,
        error: {
          ...normalized,
          details: {
            ...(normalized.details ?? {}),
            androidSnapshotTimeoutScreenshot: timeoutEvidence,
          },
        },
      };
    }
    recordSnapshotRuntimeAction({
      req,
      sessionName,
      sessionStore,
      result: result.record,
    });
    return {
      ok: true,
      data: result.data,
    };
  });
}

async function maybeCaptureAndroidSnapshotTimeoutEvidence(params: {
  error: unknown;
  command: SnapshotRuntimeCommandParams['command'];
  logPath: string;
  session: SessionState | undefined;
  device: SessionState['device'];
}): Promise<Record<string, unknown> | undefined> {
  if (params.command !== 'snapshot') return undefined;
  if (params.device.platform !== 'android') return undefined;
  if (!isAndroidSnapshotTimeoutError(params.error)) return undefined;

  try {
    const tempDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'agent-device-android-snapshot-timeout-'),
    );
    const screenshotPath = path.join(tempDir, 'snapshot-timeout-overlay-refs.png');
    const data = await dispatchCommand(params.device, 'screenshot', [screenshotPath], undefined, {
      ...contextFromFlags(
        params.logPath,
        { screenshotNoStabilize: true },
        params.session?.appBundleId,
        params.session?.trace?.outPath,
      ),
      surface: params.session?.surface,
    });
    const resolvedPath =
      typeof data === 'object' &&
      data !== null &&
      typeof (data as Record<string, unknown>).path === 'string'
        ? ((data as Record<string, unknown>).path as string)
        : screenshotPath;
    const evidence: Record<string, unknown> = {
      path: resolvedPath,
      overlayRefsRequested: true,
      overlayRefsAnnotated: false,
    };

    if (params.session?.snapshot) {
      try {
        const overlayRefs = await annotateScreenshotWithRefs({
          screenshotPath: resolvedPath,
          snapshot: params.session.snapshot,
        });
        evidence.overlayRefsAnnotated = overlayRefs.length > 0;
        evidence.overlayRefCount = overlayRefs.length;
        evidence.overlayRefSource = 'session-snapshot';
        evidence.overlayRefs = overlayRefs;
      } catch (error) {
        const normalized = normalizeError(error);
        evidence.overlayAnnotationError = normalized.message;
        emitDiagnostic({
          level: 'warn',
          phase: 'android_snapshot_timeout_screenshot_overlay_failed',
          data: { path: resolvedPath, error: normalized.message },
        });
      }
    } else {
      evidence.overlayRefSource = 'unavailable';
      evidence.overlayRefCount = 0;
    }

    emitDiagnostic({
      level: 'warn',
      phase: 'android_snapshot_timeout_screenshot_captured',
      data: {
        path: resolvedPath,
        overlayRefCount: evidence.overlayRefCount,
        overlayRefsAnnotated: evidence.overlayRefsAnnotated,
      },
    });
    return evidence;
  } catch (error) {
    const normalized = normalizeError(error);
    emitDiagnostic({
      level: 'warn',
      phase: 'android_snapshot_timeout_screenshot_failed',
      data: { error: normalized.message },
    });
    return {
      captureFailed: true,
      error: normalized.message,
    };
  }
}

function isAndroidSnapshotTimeoutError(error: unknown): boolean {
  const normalized = normalizeError(error);
  if (normalized.code !== 'COMMAND_FAILED') return false;

  const text = `${normalized.message}\n${normalized.hint ?? ''}`;
  if (/Android UI hierarchy dump timed out/i.test(text)) return true;
  if (/Stock UIAutomator fallback was skipped/i.test(text)) return true;
  if (/Android accessibility snapshots can be blocked/i.test(text)) return true;

  const details = normalized.details;
  const helper = details?.helper;
  if (helper && typeof helper === 'object') {
    const helperRecord = helper as Record<string, unknown>;
    const errorType = String(helperRecord.errorType ?? '');
    const message = String(helperRecord.message ?? '');
    if (/TimeoutException/i.test(errorType) || /timed out/i.test(message)) return true;
  }

  const timeoutMs = details?.timeoutMs;
  const cmd = details?.cmd;
  const rawArgs = details?.args;
  const args = Array.isArray(rawArgs)
    ? rawArgs.map(String)
    : typeof rawArgs === 'string'
      ? rawArgs.split(/\s+/)
      : [];
  return (
    typeof timeoutMs === 'number' &&
    cmd === 'adb' &&
    args.includes('uiautomator') &&
    args.includes('dump')
  );
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
    ...createDaemonRuntimePolicy('snapshot'),
    sessions: createDaemonRuntimeSessionStore({
      sessionName,
      getSession: () => sessionStore.get(sessionName),
      recordOptions: { includeSnapshot: true },
      setRecord: (record) => {
        const snapshotRecord = assertSnapshotSessionRecord(record);
        const current = sessionStore.get(sessionName);
        sessionStore.set(
          sessionName,
          buildNextSnapshotSession({
            current,
            sessionName,
            device,
            record: snapshotRecord,
            refScopedSnapshot: isRefScopedSnapshot(req),
          }),
        );
      },
    }),
  });
}

function buildNextSnapshotSession(params: {
  current: SessionState | undefined;
  sessionName: string;
  device: SessionState['device'];
  record: CommandSessionRecord & { snapshot: NonNullable<CommandSessionRecord['snapshot']> };
  refScopedSnapshot: boolean;
}): SessionState {
  const { current, sessionName, device, record, refScopedSnapshot } = params;
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

function recordSnapshotRuntimeAction(params: {
  req: DaemonRequest;
  sessionName: string;
  sessionStore: SessionStore;
  result: SnapshotRuntimeRecord;
}): void {
  const session = params.sessionStore.get(params.sessionName);
  if (!session) return;
  params.sessionStore.recordAction(session, {
    command: params.req.command,
    positionals: params.req.positionals ?? [],
    flags: params.req.flags ?? {},
    result: toRecordedSnapshotRuntimeResult(params.result),
  });
}

function assertSnapshotSessionRecord(
  record: CommandSessionRecord,
): CommandSessionRecord & { snapshot: NonNullable<CommandSessionRecord['snapshot']> } {
  if (!record.snapshot) {
    throw new AppError('UNKNOWN', 'snapshot runtime did not produce session state');
  }
  return record as CommandSessionRecord & {
    snapshot: NonNullable<CommandSessionRecord['snapshot']>;
  };
}

function toRecordedSnapshotRuntimeResult(record: SnapshotRuntimeRecord): Record<string, unknown> {
  if (record.kind === 'snapshot') {
    return { nodes: record.nodes, truncated: record.truncated };
  }
  return {
    mode: record.mode,
    baselineInitialized: record.baselineInitialized,
    summary: record.summary,
  };
}
