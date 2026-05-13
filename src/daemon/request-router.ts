import { withAndroidAdbProvider } from '../platforms/android/adb-executor.ts';
import type { CommandFlags } from '../core/dispatch.ts';
import {
  type DeviceInventoryProvider,
  withTargetDeviceResolutionScope,
} from '../core/dispatch-resolve.ts';
import { AppError, normalizeError } from '../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';
import { SessionStore } from './session-store.ts';
import {
  contextFromFlags as contextFromFlagsWithLog,
  type DaemonCommandContext,
} from './context.ts';
import { assertSessionSelectorMatches } from './session-selector.ts';
import { applyRequestLockPolicy } from './request-lock-policy.ts';
import { resolveEffectiveSessionName } from './session-routing.ts';
import {
  type AndroidAdbProviderResolver,
  resolveScopedAndroidAdbProvider,
} from './request-android-adb.ts';
import {
  assertRequestLeaseAdmission,
  resolveExecutionLockKey,
  scopeRequestSession,
  shouldLockSessionExecution,
  shouldValidateSessionSelector,
} from './request-admission.ts';
import {
  emitDiagnostic,
  flushDiagnosticsToSessionFile,
  getDiagnosticsMeta,
  withDiagnosticsScope,
} from '../utils/diagnostics.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import { createRequestCanceledError, isRequestCanceled } from './request-cancel.ts';
import { withKeyedLock } from '../utils/keyed-lock.ts';
import { finalizeDaemonResponse } from './request-finalization.ts';
import { dispatchGenericCommand } from './request-generic-dispatch.ts';
import {
  refreshRecordingHealth,
  shouldBlockForInvalidRecording,
} from './request-recording-health.ts';
import { runRequestHandlerChain } from './request-handler-chain.ts';

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

// ---------------------------------------------------------------------------
// Request handler API
// ---------------------------------------------------------------------------

export type RequestRouterDeps = {
  logPath: string;
  token: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  androidAdbProvider?: AndroidAdbProviderResolver;
  deviceInventoryProvider?: DeviceInventoryProvider;
  trackDownloadableArtifact: (opts: {
    artifactPath: string;
    tenantId?: string;
    fileName?: string;
  }) => string;
};

export function createRequestHandler(
  deps: RequestRouterDeps,
): (req: DaemonRequest) => Promise<DaemonResponse> {
  const { logPath, token, androidAdbProvider, deviceInventoryProvider, trackDownloadableArtifact } =
    deps;
  const { sessionStore, leaseRegistry } = deps;

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
          return await withTargetDeviceResolutionScope(deviceInventoryProvider, async () => {
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
            assertRequestLeaseAdmission(scopedReq, leaseRegistry);

            const sessionName = resolveEffectiveSessionName(scopedReq, sessionStore);
            const executionLockKey = shouldLockSessionExecution(command)
              ? await resolveExecutionLockKey({ req: scopedReq, sessionName, sessionStore })
              : null;

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
                shouldValidateSessionSelector(command)
              ) {
                assertSessionSelectorMatches(existingSession, lockedReq.flags);
              }

              const requestAdb = await resolveScopedAndroidAdbProvider({
                req: lockedReq,
                existingSession,
                androidAdbProvider,
              });
              return await withAndroidAdbProvider(
                requestAdb.provider,
                { serial: requestAdb.serial ?? '' },
                async () => {
                  // The ADB provider is scoped to this single locked request; handlers may re-read
                  // the session state, but all device-scoped adb calls in this request share it.
                  // Phase 1: Try specialized handler chain
                  const handlerResponse = await runRequestHandlerChain({
                    req: lockedReq,
                    sessionName,
                    logPath,
                    sessionStore,
                    leaseRegistry,
                    invoke: handleRequest,
                    androidAdbExecutor: requestAdb.executor,
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
                    contextFromFlags: (flags, appBundleId, traceLogPath) =>
                      contextFromFlags(logPath, flags, appBundleId, traceLogPath),
                  });
                  return finalize(dispatchResponse);
                },
              );
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
          });
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
