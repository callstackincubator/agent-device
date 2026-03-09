import path from 'node:path';
import type { CommandFlags } from '../core/dispatch.ts';
import { dispatchCommand } from '../core/dispatch.ts';
import { isCommandSupportedOnDevice } from '../core/capabilities.ts';
import { AppError, normalizeError } from '../utils/errors.ts';
import type { DaemonArtifact, DaemonRequest, DaemonResponse, DaemonResponseData } from './types.ts';
import { SessionStore } from './session-store.ts';
import { contextFromFlags as contextFromFlagsWithLog, type DaemonCommandContext } from './context.ts';
import { handleSessionCommands } from './handlers/session.ts';
import { handleSnapshotCommands } from './handlers/snapshot.ts';
import { handleFindCommands } from './handlers/find.ts';
import { handleRecordTraceCommands } from './handlers/record-trace.ts';
import { handleInteractionCommands } from './handlers/interaction.ts';
import { handleLeaseCommands } from './handlers/lease.ts';
import { assertSessionSelectorMatches } from './session-selector.ts';
import { resolveEffectiveSessionName } from './session-routing.ts';
import {
  normalizeTenantId,
  resolveSessionIsolationMode,
} from './config.ts';
import { emitDiagnostic, flushDiagnosticsToSessionFile, getDiagnosticsMeta, withDiagnosticsScope } from '../utils/diagnostics.ts';
import { resolveLeaseScope } from './lease-context.ts';
import type { LeaseRegistry } from './lease-registry.ts';

const selectorValidationExemptCommands = new Set(['session_list', 'devices', 'ensure-simulator']);
const leaseAdmissionExemptCommands = new Set([
  'session_list',
  'devices',
  'ensure-simulator',
  'lease_allocate',
  'lease_heartbeat',
  'lease_release',
]);

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

function normalizeAliasedCommands(req: DaemonRequest): DaemonRequest {
  if (req.command === 'click') {
    return { ...req, command: 'press' };
  }
  return req;
}

function scopeRequestSession(req: DaemonRequest): DaemonRequest {
  const isolation = resolveSessionIsolationMode(req.meta?.sessionIsolation ?? req.flags?.sessionIsolation);
  const rawTenant = req.meta?.tenantId ?? req.flags?.tenant;
  const tenant = normalizeTenantId(rawTenant);

  if (rawTenant && !tenant) {
    throw new AppError('INVALID_ARGS', 'Invalid tenant id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.');
  }
  if (isolation !== 'tenant') {
    return req;
  }
  if (!tenant) {
    throw new AppError('INVALID_ARGS', 'session isolation mode tenant requires --tenant (or meta.tenantId).');
  }
  return {
    ...req,
    session: `${tenant}:${req.session || 'default'}`,
    meta: {
      ...req.meta,
      tenantId: tenant,
      sessionIsolation: isolation,
    },
  };
}

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
      new AppError(response.error.code as any, response.error.message, {
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
  const hasField = (field: string): boolean => artifacts.some((artifact) => artifact?.field === field);
  if (
    req.command === 'screenshot'
    && !hasField('path')
    && typeof data.path === 'string'
  ) {
    artifacts.push({
      field: 'path',
      path: data.path,
      localPath: req.meta?.clientArtifactPaths?.path,
      fileName: path.basename(req.meta?.clientArtifactPaths?.path ?? data.path),
    });
  }
  return artifacts.filter((artifact): artifact is DaemonArtifact =>
    Boolean(
      artifact
      && typeof artifact.field === 'string'
      && typeof artifact.path === 'string'
      && typeof artifact.localPath === 'string'
      && artifact.localPath.length > 0,
    ),
  );
}

export type RequestRouterDeps = {
  logPath: string;
  token: string;
  sessionStore: SessionStore;
  leaseRegistry: LeaseRegistry;
  trackDownloadableArtifact: (opts: { artifactPath: string; tenantId?: string; fileName?: string }) => string;
};

export function createRequestHandler(deps: RequestRouterDeps): (req: DaemonRequest) => Promise<DaemonResponse> {
  const { logPath, token, sessionStore, leaseRegistry, trackDownloadableArtifact } = deps;

  async function handleRequest(req: DaemonRequest): Promise<DaemonResponse> {
    const normalizedReq = normalizeAliasedCommands(req);
    const debug = Boolean(normalizedReq.meta?.debug || normalizedReq.flags?.verbose);
    return await withDiagnosticsScope(
      {
        session: normalizedReq.session,
        requestId: normalizedReq.meta?.requestId,
        command: normalizedReq.command,
        debug,
        logPath,
      },
      async () => {
        if (normalizedReq.token !== token) {
          const unauthorizedError = normalizeError(new AppError('UNAUTHORIZED', 'Invalid token'));
          return { ok: false, error: unauthorizedError };
        }

        try {
          const scopedReq = scopeRequestSession(normalizedReq);
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
          const finalize = (response: DaemonResponse): DaemonResponse =>
            finalizeDaemonResponse(scopedReq, response, trackDownloadableArtifact);
          const leaseScope = resolveLeaseScope(scopedReq);
          if (!leaseAdmissionExemptCommands.has(command) && scopedReq.meta?.sessionIsolation === 'tenant') {
            leaseRegistry.assertLeaseAdmission({
              tenantId: leaseScope.tenantId,
              runId: leaseScope.runId,
              leaseId: leaseScope.leaseId,
              backend: leaseScope.leaseBackend,
            });
          }
          const sessionName = resolveEffectiveSessionName(scopedReq, sessionStore);
          const existingSession = sessionStore.get(sessionName);
          if (existingSession && !selectorValidationExemptCommands.has(command)) {
            assertSessionSelectorMatches(existingSession, scopedReq.flags);
          }

          const leaseResponse = await handleLeaseCommands({
            req: scopedReq,
            leaseRegistry,
          });
          if (leaseResponse) return finalize(leaseResponse);

          const sessionResponse = await handleSessionCommands({
            req: scopedReq,
            sessionName,
            logPath,
            sessionStore,
            invoke: handleRequest,
          });
          if (sessionResponse) return finalize(sessionResponse);

          const snapshotResponse = await handleSnapshotCommands({
            req: scopedReq,
            sessionName,
            logPath,
            sessionStore,
          });
          if (snapshotResponse) return finalize(snapshotResponse);

          const recordTraceResponse = await handleRecordTraceCommands({
            req: scopedReq,
            sessionName,
            sessionStore,
            logPath,
          });
          if (recordTraceResponse) return finalize(recordTraceResponse);

          const findResponse = await handleFindCommands({
            req: scopedReq,
            sessionName,
            logPath,
            sessionStore,
            invoke: handleRequest,
          });
          if (findResponse) return finalize(findResponse);

          const interactionResponse = await handleInteractionCommands({
            req: scopedReq,
            sessionName,
            sessionStore,
            contextFromFlags: (flags, appBundleId, traceLogPath) =>
              contextFromFlags(logPath, flags, appBundleId, traceLogPath),
          });
          if (interactionResponse) return finalize(interactionResponse);

          const session = sessionStore.get(sessionName);
          if (!session) {
            return finalize({
              ok: false,
              error: { code: 'SESSION_NOT_FOUND', message: 'No active session. Run open first.' },
            });
          }

          if (!isCommandSupportedOnDevice(command, session.device)) {
            return finalize({
              ok: false,
              error: { code: 'UNSUPPORTED_OPERATION', message: `${command} is not supported on this device` },
            });
          }

          const data = await dispatchCommand(session.device, command, scopedReq.positionals ?? [], scopedReq.flags?.out, {
            ...contextFromFlags(logPath, scopedReq.flags, session.appBundleId, session.trace?.outPath),
          });
          sessionStore.recordAction(session, {
            command,
            positionals: scopedReq.positionals ?? [],
            flags: scopedReq.flags ?? {},
            result: data ?? {},
          });
          return finalize({ ok: true, data: data ?? {} });
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
