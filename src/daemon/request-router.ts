import path from 'node:path';
import type { CommandFlags } from '../core/dispatch.ts';
import { dispatchCommand, resolveTargetDevice } from '../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../core/capabilities.ts';
import { AppError, normalizeError, toAppErrorCode } from '../utils/errors.ts';
import type {
  DaemonArtifact,
  DaemonRequest,
  DaemonResponse,
  DaemonResponseData,
  SessionState,
} from './types.ts';
import { SessionStore } from './session-store.ts';
import {
  contextFromFlags as contextFromFlagsWithLog,
  type DaemonCommandContext,
} from './context.ts';
import { handleSessionCommands } from './handlers/session.ts';
import { handleSnapshotCommands } from './handlers/snapshot.ts';
import { handleFindCommands } from './handlers/find.ts';
import { handleRecordTraceCommands } from './handlers/record-trace.ts';
import { handleInteractionCommands } from './handlers/interaction.ts';
import { handleLeaseCommands } from './handlers/lease.ts';
import { buildSnapshotState, captureSnapshotData } from './handlers/snapshot-capture.ts';
import { assertSessionSelectorMatches } from './session-selector.ts';
import { setSessionSnapshot } from './session-snapshot.ts';
import { applyRequestLockPolicy } from './request-lock-policy.ts';
import { resolveEffectiveSessionName } from './session-routing.ts';
import { normalizeTenantId, resolveSessionIsolationMode } from './config.ts';
import {
  emitDiagnostic,
  flushDiagnosticsToSessionFile,
  getDiagnosticsMeta,
  withDiagnosticsScope,
} from '../utils/diagnostics.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import { resolveLeaseScope } from './lease-context.ts';
import {
  augmentScrollVisualizationResult,
  recordTouchVisualizationEvent,
} from './recording-gestures.ts';
import {
  dispatchScreenshotViaRuntime,
  type ScreenshotOutputPlacement,
} from './screenshot-runtime.ts';
import { recoverAndroidBlockingSystemDialog } from './android-system-dialog.ts';
import { getRunnerSessionSnapshot } from '../platforms/ios/runner-client.ts';
import { annotateScreenshotWithRefs } from './screenshot-overlay.ts';
import { createRequestCanceledError, isRequestCanceled } from './request-cancel.ts';
import {
  isNavigationSensitiveAction,
  markAndroidSnapshotFreshness,
} from './android-snapshot-freshness.ts';
import { withKeyedLock } from '../utils/keyed-lock.ts';
import { hasExplicitDeviceSelector } from './handlers/session-device-utils.ts';

// ---------------------------------------------------------------------------
// Command exemption sets
// ---------------------------------------------------------------------------

const selectorValidationExemptCommands = new Set([
  'session_list',
  'devices',
  'ensure-simulator',
  'release_materialized_paths',
]);
const leaseAdmissionExemptCommands = new Set([
  'session_list',
  'devices',
  'ensure-simulator',
  'release_materialized_paths',
  'lease_allocate',
  'lease_heartbeat',
  'lease_release',
]);
const sessionExecutionExemptCommands = new Set(leaseAdmissionExemptCommands);
const sessionExecutionLocks = new Map<string, Promise<unknown>>();

// ---------------------------------------------------------------------------
// Request preparation helpers
// ---------------------------------------------------------------------------

function throwIfRequestCanceled(req: DaemonRequest): void {
  if (isRequestCanceled(req.meta?.requestId)) {
    throw createRequestCanceledError();
  }
}

function contextFromFlags(
  logPath: string,
  flags: CommandFlags | undefined,
  appBundleId?: string,
  traceLogPath?: string,
): DaemonCommandContext {
  const requestId = getDiagnosticsMeta().requestId;
  return {
    ...contextFromFlagsWithLog(logPath, flags, appBundleId, traceLogPath, requestId),
    requestId,
  };
}

function scopeRequestSession(req: DaemonRequest): DaemonRequest {
  const isolation = resolveSessionIsolationMode(
    req.meta?.sessionIsolation ?? req.flags?.sessionIsolation,
  );
  const rawTenant = req.meta?.tenantId ?? req.flags?.tenant;
  const tenant = normalizeTenantId(rawTenant);

  if (rawTenant && !tenant) {
    throw new AppError(
      'INVALID_ARGS',
      'Invalid tenant id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.',
    );
  }
  if (isolation !== 'tenant') {
    return req;
  }
  if (!tenant) {
    throw new AppError(
      'INVALID_ARGS',
      'session isolation mode tenant requires --tenant (or meta.tenantId).',
    );
  }
  const requestedSession = req.session || 'default';
  if (requestedSession.startsWith(`${tenant}:`)) {
    return {
      ...req,
      meta: {
        ...req.meta,
        tenantId: tenant,
        sessionIsolation: isolation,
      },
    };
  }
  return {
    ...req,
    session: `${tenant}:${requestedSession}`,
    meta: {
      ...req.meta,
      tenantId: tenant,
      sessionIsolation: isolation,
    },
  };
}

// ---------------------------------------------------------------------------
// Response finalization
// ---------------------------------------------------------------------------

function finalizeDaemonResponse(
  req: DaemonRequest,
  response: DaemonResponse,
  trackArtifact: (opts: { artifactPath: string; tenantId?: string; fileName?: string }) => string,
): DaemonResponse {
  const details = getDiagnosticsMeta();
  if (!response.ok) {
    emitDiagnostic({
      level: 'error',
      phase: 'request_failed',
      data: {
        code: response.error.code,
        message: response.error.message,
      },
    });
    const logPathOnFailure = flushDiagnosticsToSessionFile({ force: true }) ?? undefined;
    const normalizedError = normalizeError(
      new AppError(toAppErrorCode(response.error.code), response.error.message, {
        ...(response.error.details ?? {}),
        hint: response.error.hint,
        diagnosticId: response.error.diagnosticId,
        logPath: response.error.logPath,
      }),
      {
        diagnosticId: details.diagnosticId,
        logPath: logPathOnFailure,
      },
    );
    return { ok: false, error: normalizedError };
  }
  emitDiagnostic({ level: 'info', phase: 'request_success' });
  flushDiagnosticsToSessionFile();
  return {
    ok: true,
    data: registerDownloadableArtifacts(req, response.data, trackArtifact),
  };
}

function registerDownloadableArtifacts(
  req: DaemonRequest,
  data: DaemonResponseData | undefined,
  trackArtifact: (opts: { artifactPath: string; tenantId?: string; fileName?: string }) => string,
): DaemonResponseData | undefined {
  if (!data) return data;
  const pendingArtifacts = collectPendingArtifacts(req, data);
  if (pendingArtifacts.length === 0) return data;
  return {
    ...data,
    artifacts: pendingArtifacts.map((artifact) => {
      const artifactPath = artifact.path as string;
      return {
        field: artifact.field,
        artifactId: trackArtifact({
          artifactPath,
          tenantId: req.meta?.tenantId,
          fileName: artifact.fileName,
        }),
        fileName: artifact.fileName,
        localPath: artifact.localPath,
      };
    }),
  };
}

function collectPendingArtifacts(req: DaemonRequest, data: DaemonResponseData): DaemonArtifact[] {
  const artifacts = Array.isArray(data.artifacts) ? [...data.artifacts] : [];
  const hasField = (field: string): boolean =>
    artifacts.some((artifact) => artifact?.field === field);
  if (req.command === 'screenshot' && !hasField('path') && typeof data.path === 'string') {
    artifacts.push({
      field: 'path',
      path: data.path,
      localPath: req.meta?.clientArtifactPaths?.path,
      fileName: path.basename(req.meta?.clientArtifactPaths?.path ?? data.path),
    });
  }
  return artifacts.filter((artifact): artifact is DaemonArtifact =>
    Boolean(
      artifact &&
      typeof artifact.field === 'string' &&
      typeof artifact.path === 'string' &&
      typeof artifact.localPath === 'string' &&
      artifact.localPath.length > 0,
    ),
  );
}

// ---------------------------------------------------------------------------
// Session health & lock resolution
// ---------------------------------------------------------------------------

function refreshRecordingHealth(session: SessionState): void {
  const recording = session.recording;
  if (!recording || session.device.platform !== 'ios') {
    return;
  }

  const snapshot = getRunnerSessionSnapshot(session.device.id);
  if (!recording.runnerSessionId) {
    if (snapshot?.alive) {
      recording.runnerSessionId = snapshot.sessionId;
    }
    return;
  }

  if (!snapshot?.alive) {
    recording.invalidatedReason ??= 'iOS runner session exited during recording';
    return;
  }

  if (snapshot.sessionId !== recording.runnerSessionId) {
    recording.invalidatedReason ??= 'iOS runner session restarted during recording';
  }
}

function shouldBlockForInvalidRecording(command: string): boolean {
  return command !== 'record' && command !== 'close';
}

async function resolveExecutionLockKey(
  req: DaemonRequest,
  sessionName: string,
  sessionStore: SessionStore,
): Promise<string> {
  const existingSession = sessionStore.get(sessionName);
  if (existingSession) {
    return `device:${existingSession.device.id}`;
  }
  if (req.command === 'open' || hasExplicitDeviceSelector(req.flags)) {
    try {
      const device = await resolveTargetDevice(req.flags ?? {});
      return `device:${device.id}`;
    } catch {
      // Fall back to session scoping when device resolution is not yet available.
    }
  }
  return `session:${sessionName}`;
}

// ---------------------------------------------------------------------------
// Specialized handler chain
// ---------------------------------------------------------------------------

async function runHandlerChain(params: {
  req: DaemonRequest;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  invoke: (req: DaemonRequest) => Promise<DaemonResponse>;
  contextFromFlags: (
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ) => DaemonCommandContext;
}): Promise<DaemonResponse | null> {
  const { req, sessionName, logPath, sessionStore, leaseRegistry, invoke, contextFromFlags } =
    params;

  const leaseResponse = await handleLeaseCommands({ req, leaseRegistry });
  if (leaseResponse) return leaseResponse;

  const sessionResponse = await handleSessionCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
  });
  if (sessionResponse) return sessionResponse;

  const snapshotResponse = await handleSnapshotCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
  });
  if (snapshotResponse) return snapshotResponse;

  const recordTraceResponse = await handleRecordTraceCommands({
    req,
    sessionName,
    sessionStore,
    logPath,
  });
  if (recordTraceResponse) return recordTraceResponse;

  const findResponse = await handleFindCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    invoke,
  });
  if (findResponse) return findResponse;

  const interactionResponse = await handleInteractionCommands({
    req,
    sessionName,
    logPath,
    sessionStore,
    contextFromFlags,
  });
  if (interactionResponse) return interactionResponse;

  return null;
}

// ---------------------------------------------------------------------------
// Generic command dispatch (fallback when no specialized handler matched)
// ---------------------------------------------------------------------------

async function dispatchGenericCommand(params: {
  req: DaemonRequest;
  session: SessionState;
  sessionName: string;
  logPath: string;
  sessionStore: SessionStore;
}): Promise<DaemonResponse> {
  const { req, session, logPath, sessionStore } = params;
  const command = req.command;

  if (!isCommandSupportedOnDevice(command, session.device)) {
    return {
      ok: false,
      error: {
        code: 'UNSUPPORTED_OPERATION',
        message: `${command} is not supported on this device`,
      },
    };
  }

  if (session.device.platform === 'android' && session.recording && command !== 'record') {
    const androidRecoveryResult = await recoverAndroidBlockingSystemDialog({ session });
    if (androidRecoveryResult === 'failed') {
      return {
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: 'Android system dialog blocked the recording session',
        },
      };
    }
  }

  const { resolvedPositionals, resolvedOut, recordedPositionals, recordedFlags } =
    resolveCommandPositionals(req);

  const actionStartedAt = Date.now();
  const dispatchContext = {
    ...contextFromFlags(logPath, req.flags, session.appBundleId, session.trace?.outPath),
    surface: session.surface,
  };
  const data =
    command === 'screenshot'
      ? await dispatchScreenshotViaRuntime({
          session,
          sessionName: params.sessionName,
          outPath: resolvedPositionals[0] ?? resolvedOut,
          outputPlacement: resolveScreenshotOutputPlacement(req),
          dispatchContext,
        })
      : await dispatchCommand(session.device, command, resolvedPositionals, resolvedOut, {
          ...dispatchContext,
        });

  if (command === 'screenshot' && req.flags?.overlayRefs && typeof data?.path === 'string') {
    await applyScreenshotOverlay(session, data, logPath);
  }

  const actionFinishedAt = Date.now();
  recordVisualizationAndAction({
    session,
    sessionStore,
    command,
    resolvedPositionals,
    recordedPositionals,
    recordedFlags,
    data,
    actionStartedAt,
    actionFinishedAt,
    flags: req.flags ?? {},
  });

  if (isNavigationSensitiveAction(command)) {
    markAndroidSnapshotFreshness(session, command);
  }

  return { ok: true, data: data ?? {} };
}

function resolveScreenshotOutputPlacement(req: DaemonRequest): ScreenshotOutputPlacement {
  if (req.command !== 'screenshot') return 'default';
  if ((req.positionals ?? [])[0]) return 'positional';
  if (req.flags?.out) return 'out';
  return 'default';
}

function resolveCommandPositionals(req: DaemonRequest): {
  resolvedPositionals: string[];
  resolvedOut: string | undefined;
  recordedPositionals: string[];
  recordedFlags: Record<string, unknown>;
} {
  const command = req.command;
  const positionals = req.positionals ?? [];
  const outFlag = req.flags?.out;
  const resolvedPositionals =
    command === 'screenshot' && positionals[0]
      ? [SessionStore.expandHome(positionals[0], req.meta?.cwd), ...positionals.slice(1)]
      : positionals;
  const resolvedOut =
    command === 'screenshot' && outFlag ? SessionStore.expandHome(outFlag, req.meta?.cwd) : outFlag;
  const recordedPositionals = command === 'screenshot' ? resolvedPositionals : positionals;
  const recordedFlags =
    command === 'screenshot' && resolvedOut
      ? { ...(req.flags ?? {}), out: resolvedOut }
      : (req.flags ?? {});
  return { resolvedPositionals, resolvedOut, recordedPositionals, recordedFlags };
}

async function applyScreenshotOverlay(
  session: SessionState,
  data: Record<string, unknown>,
  logPath: string,
): Promise<void> {
  const overlaySnapshotData = await captureSnapshotData({
    device: session.device,
    session,
    flags: undefined,
    logPath,
    snapshotScope: undefined,
  });
  const overlaySnapshot = buildSnapshotState(overlaySnapshotData, undefined);
  setSessionSnapshot(session, overlaySnapshot);
  const overlayRefs = await annotateScreenshotWithRefs({
    screenshotPath: data.path as string,
    snapshot: overlaySnapshot,
  });
  data.overlayRefs = overlayRefs;
}

function recordVisualizationAndAction(params: {
  session: SessionState;
  sessionStore: SessionStore;
  command: string;
  resolvedPositionals: string[];
  recordedPositionals: string[];
  recordedFlags: Record<string, unknown>;
  data: Record<string, unknown> | void;
  actionStartedAt: number;
  actionFinishedAt: number;
  flags: Record<string, unknown>;
}): void {
  const {
    session,
    sessionStore,
    command,
    resolvedPositionals,
    recordedPositionals,
    recordedFlags,
    data,
    actionStartedAt,
    actionFinishedAt,
    flags,
  } = params;
  const visualizationData = augmentScrollVisualizationResult(
    session,
    command,
    resolvedPositionals,
    data as Record<string, unknown> | void,
  );
  recordTouchVisualizationEvent(
    session,
    command,
    resolvedPositionals,
    visualizationData as Record<string, unknown> | void,
    flags,
    actionStartedAt,
    actionFinishedAt,
  );
  sessionStore.recordAction(session, {
    command,
    positionals: recordedPositionals,
    flags: recordedFlags,
    result: data ?? {},
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RequestRouterDeps = {
  logPath: string;
  token: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  trackDownloadableArtifact: (opts: {
    artifactPath: string;
    tenantId?: string;
    fileName?: string;
  }) => string;
};

export function createRequestHandler(
  deps: RequestRouterDeps,
): (req: DaemonRequest) => Promise<DaemonResponse> {
  const { logPath, token, sessionStore, leaseRegistry, trackDownloadableArtifact } = deps;

  async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
    const debug = Boolean(req.meta?.debug || req.flags?.verbose);
    return await withDiagnosticsScope(
      {
        session: req.session,
        requestId: req.meta?.requestId,
        command: req.command,
        debug,
        logPath,
      },
      async () => {
        if (req.token !== token) {
          const unauthorizedError = normalizeError(new AppError('UNAUTHORIZED', 'Invalid token'));
          return { ok: false, error: unauthorizedError };
        }

        try {
          const scopedReq = scopeRequestSession(req);
          emitDiagnostic({
            level: 'info',
            phase: 'request_start',
            data: {
              session: scopedReq.session,
              command: scopedReq.command,
              tenant: scopedReq.meta?.tenantId,
              isolation: scopedReq.meta?.sessionIsolation,
            },
          });

          const command = scopedReq.command;
          const leaseScope = resolveLeaseScope(scopedReq);
          if (
            !leaseAdmissionExemptCommands.has(command) &&
            scopedReq.meta?.sessionIsolation === 'tenant'
          ) {
            leaseRegistry.assertLeaseAdmission({
              tenantId: leaseScope.tenantId,
              runId: leaseScope.runId,
              leaseId: leaseScope.leaseId,
              backend: leaseScope.leaseBackend,
            });
          }

          const sessionName = resolveEffectiveSessionName(scopedReq, sessionStore);
          const executionLockKey = sessionExecutionExemptCommands.has(command)
            ? null
            : await resolveExecutionLockKey(scopedReq, sessionName, sessionStore);

          const executeSessionRequest = async (): Promise<DaemonResponse> => {
            throwIfRequestCanceled(scopedReq);
            const existingSession = sessionStore.get(sessionName);
            if (existingSession) {
              refreshRecordingHealth(existingSession);
              sessionStore.set(sessionName, existingSession);
            }
            const lockedReq = applyRequestLockPolicy(scopedReq, existingSession);
            const finalize = (response: DaemonResponse): DaemonResponse =>
              finalizeDaemonResponse(lockedReq, response, trackDownloadableArtifact);

            if (
              existingSession?.recording?.invalidatedReason &&
              shouldBlockForInvalidRecording(command)
            ) {
              return finalize({
                ok: false,
                error: {
                  code: 'COMMAND_FAILED',
                  message: existingSession.recording.invalidatedReason,
                },
              });
            }
            if (
              existingSession &&
              !lockedReq.meta?.lockPolicy &&
              !selectorValidationExemptCommands.has(command)
            ) {
              assertSessionSelectorMatches(existingSession, lockedReq.flags);
            }

            // Phase 1: Try specialized handler chain
            const handlerResponse = await runHandlerChain({
              req: lockedReq,
              sessionName,
              logPath,
              sessionStore,
              leaseRegistry,
              invoke: handleRequest,
              contextFromFlags: (flags, appBundleId, traceLogPath) =>
                ({
                  ...contextFromFlags(logPath, flags, appBundleId, traceLogPath),
                  surface: sessionStore.get(sessionName)?.surface,
                }) satisfies DaemonCommandContext,
            });
            if (handlerResponse) return finalize(handlerResponse);

            // Phase 2: Require active session for generic dispatch
            const session = sessionStore.get(sessionName);
            if (!session) {
              return finalize({
                ok: false,
                error: {
                  code: 'SESSION_NOT_FOUND',
                  message: 'No active session. Run open first.',
                },
              });
            }

            // Phase 3: Dispatch command directly to device
            const dispatchResponse = await dispatchGenericCommand({
              req: lockedReq,
              session,
              sessionName,
              logPath,
              sessionStore,
            });
            return finalize(dispatchResponse);
          };

          if (!executionLockKey) {
            throwIfRequestCanceled(scopedReq);
            return await executeSessionRequest();
          }
          throwIfRequestCanceled(scopedReq);
          return await withKeyedLock(
            sessionExecutionLocks,
            executionLockKey,
            executeSessionRequest,
          );
        } catch (error) {
          emitDiagnostic({
            level: 'error',
            phase: 'request_failed',
            data: {
              error: error instanceof Error ? error.message : String(error),
            },
          });
          const details = getDiagnosticsMeta();
          const logPathOnFailure = flushDiagnosticsToSessionFile({ force: true }) ?? undefined;
          const normalizedError = normalizeError(error, {
            diagnosticId: details.diagnosticId,
            logPath: logPathOnFailure,
          });
          return { ok: false, error: normalizedError };
        }
      },
    );
  }

  return handleRequest;
}
