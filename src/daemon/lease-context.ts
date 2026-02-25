import type { DaemonRequest } from './types.ts';

export type LeaseScope = {
  tenantId?: string;
  runId?: string;
  leaseId?: string;
  leaseTtlMs?: number;
  leaseBackend?: 'ios-simulator';
};

export function resolveLeaseScope(req: Pick<DaemonRequest, 'flags' | 'meta'>): LeaseScope {
  return {
    tenantId: req.meta?.tenantId ?? req.flags?.tenant,
    runId: req.meta?.runId ?? req.flags?.runId,
    leaseId: req.meta?.leaseId ?? req.flags?.leaseId,
    leaseTtlMs: req.meta?.leaseTtlMs,
    leaseBackend: req.meta?.leaseBackend,
  };
}
