import type { CommandFlags } from '../core/dispatch.ts';
import { withKeyedLock } from '../utils/keyed-lock.ts';
import { emitDiagnostic, getDiagnosticsMeta } from '../utils/diagnostics.ts';
import { applyCommandDefaults } from '../utils/command-schema.ts';
import type { DaemonCommandContext } from './context.ts';
import { contextFromFlags as contextFromFlagsWithLog } from './context.ts';
import { assertSessionSelectorMatches } from './session-selector.ts';
import { resolveEffectiveSessionName } from './session-routing.ts';
import {
  assertRequestLeaseAdmission,
  scopeRequestSession,
  shouldLockSessionExecution,
  shouldValidateSessionSelector,
} from './request-admission.ts';
import {
  prepareLockedRequestBinding,
  resolveRequestExecutionLockKeys,
  type RequestExecutionLockKey,
} from './request-binding.ts';
import { throwIfRequestCanceled } from './request-cancel.ts';
import { finalizeDaemonResponse } from './request-finalization.ts';
import {
  refreshRecordingHealth,
  shouldBlockForInvalidRecording,
} from './request-recording-health.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import type { SessionStore } from './session-store.ts';
import type { DaemonRequest, DaemonResponse, SessionState } from './types.ts';

// Production daemon wiring owns one LeaseRegistry per process; scoping locks by registry keeps
// test and embedded routers isolated without changing process-level serialization there.
const leaseRegistryExecutionLocks = new WeakMap<LeaseRegistry, Map<string, Promise<unknown>>>();

export type RequestExecutionScope = {
  req: DaemonRequest;
  command: string;
  sessionName: string;
  runLocked<T>(task: () => Promise<T>): Promise<T>;
  throwIfCanceled(): void;
};

export type LockedRequestScope = {
  req: DaemonRequest;
  sessionName: string;
  existingSession: SessionState | undefined;
  finalize(response: DaemonResponse): DaemonResponse;
  contextFromFlags(
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ): DaemonCommandContext;
  handlerContextFromFlags(
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ): DaemonCommandContext;
};

export type LockedRequestScopeResult =
  | { type: 'scope'; scope: LockedRequestScope }
  | { type: 'response'; response: DaemonResponse };

export async function createRequestExecutionScope(params: {
  req: DaemonRequest;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
}): Promise<RequestExecutionScope> {
  const { sessionStore, leaseRegistry } = params;
  const scopedReq = applyRequestCommandDefaults(scopeRequestSession(params.req));
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
  const executionLockKeys = shouldLockSessionExecution(command)
    ? await resolveRequestExecutionLockKeys({ req: scopedReq, sessionName, sessionStore })
    : [];
  const executionLocks = getLeaseRegistryExecutionLocks(leaseRegistry);

  const scope: RequestExecutionScope = {
    req: scopedReq,
    command,
    sessionName,
    throwIfCanceled: () => throwIfRequestCanceled(scopedReq.meta?.requestId),
    runLocked: async (task) => {
      throwIfRequestCanceled(scopedReq.meta?.requestId);
      if (executionLockKeys.length === 0) return await task();
      return await withRequestExecutionLocks(executionLocks, executionLockKeys, async () => {
        throwIfRequestCanceled(scopedReq.meta?.requestId);
        return await task();
      });
    },
  };
  return scope;
}

async function withRequestExecutionLocks<T>(
  locks: Map<string, Promise<unknown>>,
  keys: RequestExecutionLockKey[],
  task: () => Promise<T>,
): Promise<T> {
  const [key, ...remainingKeys] = keys;
  if (!key) return await task();
  return await withKeyedLock(
    locks,
    key,
    async () => await withRequestExecutionLocks(locks, remainingKeys, task),
  );
}

function applyRequestCommandDefaults(req: DaemonRequest): DaemonRequest {
  const flags = { ...(req.flags ?? {}) };
  const changed = applyCommandDefaults(req.command, flags);
  if (!changed && req.flags) return req;
  if (!changed) return req;
  return {
    ...req,
    flags: flags as CommandFlags,
  };
}

export function prepareLockedRequestScope(params: {
  scope: RequestExecutionScope;
  logPath: string;
  sessionStore: SessionStore;
  trackDownloadableArtifact: (opts: {
    artifactPath: string;
    tenantId?: string;
    fileName?: string;
  }) => string;
}): LockedRequestScopeResult {
  const { scope, logPath, sessionStore, trackDownloadableArtifact } = params;
  scope.throwIfCanceled();
  let existingSession = sessionStore.get(scope.sessionName);
  if (existingSession) {
    // Called under runLocked: refreshRecordingHealth may mutate session recording state.
    refreshRecordingHealth(existingSession);
    sessionStore.set(scope.sessionName, existingSession);
  }
  const binding = prepareLockedRequestBinding({
    req: scope.req,
    sessionName: scope.sessionName,
    sessionStore,
  });
  const lockedReq = binding.req;
  existingSession = binding.existingSession;
  const finalize = (response: DaemonResponse): DaemonResponse =>
    finalizeDaemonResponse(lockedReq, response, trackDownloadableArtifact);

  if (
    existingSession?.recording?.invalidatedReason &&
    shouldBlockForInvalidRecording(scope.command)
  ) {
    return {
      type: 'response',
      response: finalize({
        ok: false,
        error: {
          code: 'COMMAND_FAILED',
          message: existingSession.recording.invalidatedReason,
        },
      }),
    };
  }

  if (
    existingSession &&
    !lockedReq.meta?.lockPolicy &&
    shouldValidateSessionSelector(scope.command)
  ) {
    assertSessionSelectorMatches(existingSession, lockedReq.flags);
  }

  const contextFromFlags = (
    flags: CommandFlags | undefined,
    appBundleId?: string,
    traceLogPath?: string,
  ): DaemonCommandContext => contextFromRequestFlags(logPath, flags, appBundleId, traceLogPath);

  return {
    type: 'scope',
    scope: {
      req: lockedReq,
      sessionName: scope.sessionName,
      existingSession,
      finalize,
      contextFromFlags,
      handlerContextFromFlags: (flags, appBundleId, traceLogPath) =>
        ({
          ...contextFromFlags(flags, appBundleId, traceLogPath),
          // Handlers may update surface during the request, so read the current session state.
          surface: sessionStore.get(scope.sessionName)?.surface,
        }) satisfies DaemonCommandContext,
    },
  };
}

function contextFromRequestFlags(
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

function getLeaseRegistryExecutionLocks(
  leaseRegistry: LeaseRegistry,
): Map<string, Promise<unknown>> {
  let locks = leaseRegistryExecutionLocks.get(leaseRegistry);
  if (!locks) {
    locks = new Map();
    leaseRegistryExecutionLocks.set(leaseRegistry, locks);
  }
  return locks;
}
