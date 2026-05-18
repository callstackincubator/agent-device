import {
  type DeviceInventoryProvider,
  withTargetDeviceResolutionScope,
} from '../core/dispatch-resolve.ts';
import { AppError, normalizeError } from '../utils/errors.ts';
import type { DaemonRequest, DaemonResponse } from './types.ts';
import { SessionStore } from './session-store.ts';
import {
  type AndroidAdbProviderResolver,
  type AppleRunnerProviderResolver,
  type AppleToolProviderResolver,
  type AppLogProviderResolver,
  type LinuxToolProviderResolver,
  type RequestPlatformProviderScope,
  type RecordingProviderResolver,
  withRequestPlatformProviderScope,
} from './request-platform-providers.ts';
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
  type LockedRequestScope,
  prepareLockedRequestScope,
} from './request-execution-scope.ts';
import { DAEMON_COMMAND_GROUPS } from '../command-catalog.ts';

// ---------------------------------------------------------------------------
// Request handler API
// ---------------------------------------------------------------------------

export type RequestRouterDeps = {
  logPath: string;
  token: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  androidAdbProvider?: AndroidAdbProviderResolver;
  appleRunnerProvider?: AppleRunnerProviderResolver;
  appleToolProvider?: AppleToolProviderResolver;
  linuxToolProvider?: LinuxToolProviderResolver;
  appLogProvider?: AppLogProviderResolver;
  recordingProvider?: RecordingProviderResolver;
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
  const {
    logPath,
    token,
    androidAdbProvider,
    appleRunnerProvider,
    appleToolProvider,
    linuxToolProvider,
    appLogProvider,
    recordingProvider,
    deviceInventoryProvider,
    trackDownloadableArtifact,
  } = deps;
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

              return await withRequestPlatformProviderScope(
                {
                  req: lockedScope.req,
                  existingSession: lockedScope.existingSession,
                  providers: {
                    androidAdbProvider,
                    appleRunnerProvider,
                    appleToolProvider,
                    linuxToolProvider,
                    appLogProvider,
                    recordingProvider,
                  },
                },
                async (providerScope) => {
                  // Platform providers are scoped to this single locked request; handlers may
                  // re-read session state, but all device-scoped calls in this request share them.
                  // Phase 1: Try specialized handler chain
                  const handlerResponse = await runRequestHandlerChain({
                    req: lockedScope.req,
                    sessionName: lockedScope.sessionName,
                    logPath,
                    sessionStore,
                    leaseRegistry,
                    invoke: handleRequest,
                    invokeReplayAction: createReplayScopedActionInvoker({
                      parentScope: lockedScope,
                      providerScope,
                      handleRequest,
                      deps: {
                        logPath,
                        token,
                        sessionStore,
                        leaseRegistry,
                        trackDownloadableArtifact,
                      },
                    }),
                    androidAdbExecutor: providerScope.androidAdbExecutor,
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
          return finalizeThrownRequestError(error);
        }
      },
    );
  }

  return handleRequest;
}

type ReplayScopedActionInvokerDeps = {
  logPath: string;
  token: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  trackDownloadableArtifact: RequestRouterDeps['trackDownloadableArtifact'];
};

function createReplayScopedActionInvoker(params: {
  parentScope: LockedRequestScope;
  providerScope: RequestPlatformProviderScope;
  handleRequest: (req: DaemonRequest) => Promise<DaemonResponse>;
  deps: ReplayScopedActionInvokerDeps;
}): (req: DaemonRequest) => Promise<DaemonResponse> {
  const { parentScope, providerScope, handleRequest, deps } = params;
  return async (req) => {
    if (!canRunReplayActionInCurrentScope(req, parentScope)) {
      return await handleRequest(req);
    }
    if (req.token !== deps.token) {
      const unauthorizedError = normalizeError(new AppError('UNAUTHORIZED', 'Invalid token'));
      return { ok: false, error: unauthorizedError };
    }

    try {
      const childScope = await createRequestExecutionScope({
        req,
        sessionStore: deps.sessionStore,
        leaseRegistry: deps.leaseRegistry,
      });
      if (childScope.sessionName !== parentScope.sessionName) {
        return await handleRequest(req);
      }

      const locked = prepareLockedRequestScope({
        scope: childScope,
        logPath: deps.logPath,
        sessionStore: deps.sessionStore,
        trackDownloadableArtifact: deps.trackDownloadableArtifact,
      });
      if (locked.type === 'response') return locked.response;
      const lockedScope = locked.scope;

      const handlerResponse = await runRequestHandlerChain({
        req: lockedScope.req,
        sessionName: lockedScope.sessionName,
        logPath: deps.logPath,
        sessionStore: deps.sessionStore,
        leaseRegistry: deps.leaseRegistry,
        invoke: handleRequest,
        androidAdbExecutor: providerScope.androidAdbExecutor,
        contextFromFlags: lockedScope.handlerContextFromFlags,
      });
      if (handlerResponse) return lockedScope.finalize(handlerResponse);

      const session = deps.sessionStore.get(lockedScope.sessionName);
      if (!session) {
        return lockedScope.finalize({
          ok: false,
          error: {
            code: 'SESSION_NOT_FOUND',
            message: 'No active session. Run open first.',
          },
        });
      }

      const dispatchResponse = await dispatchGenericCommand({
        req: lockedScope.req,
        session,
        sessionName: lockedScope.sessionName,
        logPath: deps.logPath,
        sessionStore: deps.sessionStore,
        contextFromFlags: lockedScope.contextFromFlags,
      });
      return lockedScope.finalize(dispatchResponse);
    } catch (error) {
      return finalizeThrownRequestError(error);
    }
  };
}

function canRunReplayActionInCurrentScope(
  req: DaemonRequest,
  parentScope: LockedRequestScope,
): boolean {
  return (
    req.session === parentScope.sessionName &&
    DAEMON_COMMAND_GROUPS.replayScopedAction.has(req.command)
  );
}

function finalizeThrownRequestError(error: unknown): DaemonResponse {
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
