import {
  type DeviceInventoryProvider,
  withTargetDeviceResolutionScope,
} from '../core/dispatch-resolve.ts';
import { AppError, normalizeError } from '../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';
import { SessionStore } from './session-store.ts';
import {
  type AndroidAdbProviderResolver,
  withRequestAndroidAdbScope,
} from './request-android-adb.ts';
import {
  emitDiagnostic,
  flushDiagnosticsToSessionFile,
  getDiagnosticsMeta,
  withDiagnosticsScope,
} from '../utils/diagnostics.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import { dispatchGenericCommand } from './request-generic-dispatch.ts';
import { runRequestHandlerChain } from './request-handler-chain.ts';
import {
  createRequestExecutionScope,
  prepareLockedRequestScope,
} from './request-execution-scope.ts';

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
            const scope = await createRequestExecutionScope({
              req,
              sessionStore,
              leaseRegistry,
            });

            return await scope.runLocked(async () => {
              const locked = prepareLockedRequestScope({
                scope,
                logPath,
                sessionStore,
                trackDownloadableArtifact,
              });
              if (locked.type === 'response') return locked.response;
              const lockedScope = locked.scope;

              return await withRequestAndroidAdbScope(
                {
                  req: lockedScope.req,
                  existingSession: lockedScope.existingSession,
                  androidAdbProvider,
                },
                async (executor) => {
                  // The ADB provider is scoped to this single locked request; handlers may re-read
                  // the session state, but all device-scoped adb calls in this request share it.
                  // Phase 1: Try specialized handler chain
                  const handlerResponse = await runRequestHandlerChain({
                    req: lockedScope.req,
                    sessionName: lockedScope.sessionName,
                    logPath,
                    sessionStore,
                    leaseRegistry,
                    invoke: handleRequest,
                    androidAdbExecutor: executor,
                    contextFromFlags: lockedScope.handlerContextFromFlags,
                  });
                  if (handlerResponse) return lockedScope.finalize(handlerResponse);

                  // Phase 2: Require active session for generic dispatch
                  const session = sessionStore.get(lockedScope.sessionName);
                  if (!session) {
                    return lockedScope.finalize({
                      ok: false,
                      error: {
                        code: 'SESSION_NOT_FOUND',
                        message: 'No active session. Run open first.',
                      },
                    });
                  }

                  // Phase 3: Dispatch command directly to device
                  const dispatchResponse = await dispatchGenericCommand({
                    req: lockedScope.req,
                    session,
                    sessionName: lockedScope.sessionName,
                    logPath,
                    sessionStore,
                    contextFromFlags: lockedScope.contextFromFlags,
                  });
                  return lockedScope.finalize(dispatchResponse);
                },
              );
            });
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
