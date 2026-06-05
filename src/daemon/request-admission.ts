import { AppError } from '../utils/errors.ts';
import { normalizeTenantId, resolveSessionIsolationMode } from './config.ts';
import { isLeaseAdmissionExempt } from './daemon-command-registry.ts';
import { resolveLeaseScope } from './lease-context.ts';
import type { LeaseRegistry } from './lease-registry.ts';
import type { DaemonRequest } from './types.ts';

export function scopeRequestSession(req: DaemonRequest): DaemonRequest {
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

export function assertRequestLeaseAdmission(
  req: DaemonRequest,
  leaseRegistry: LeaseRegistry,
): void {
  if (isLeaseAdmissionExempt(req.command) || req.meta?.sessionIsolation !== 'tenant') {
    return;
  }
  const leaseScope = resolveLeaseScope(req);
  leaseRegistry.assertLeaseAdmission({
    tenantId: leaseScope.tenantId,
    runId: leaseScope.runId,
    leaseId: leaseScope.leaseId,
    backend: leaseScope.leaseBackend,
  });
}
