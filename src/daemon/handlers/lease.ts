import type { DaemonRequest, DaemonResponse } from '../types.ts';
import type { LeaseRegistry } from '../lease-registry.ts';

type LeaseHandlerArgs = {
  req: DaemonRequest;
  leaseRegistry: LeaseRegistry;
};

export async function handleLeaseCommands(args: LeaseHandlerArgs): Promise<DaemonResponse | null> {
  const { req, leaseRegistry } = args;
  switch (req.command) {
    case 'lease_allocate': {
      const lease = leaseRegistry.allocateLease({
        tenantId: req.meta?.tenantId ?? req.flags?.tenant ?? '',
        runId: req.meta?.runId ?? req.flags?.runId ?? '',
        backend: req.meta?.leaseBackend,
        ttlMs: req.meta?.leaseTtlMs,
      });
      return {
        ok: true,
        data: { lease },
      };
    }
    case 'lease_heartbeat': {
      const lease = leaseRegistry.heartbeatLease({
        leaseId: req.meta?.leaseId ?? req.flags?.leaseId ?? '',
        tenantId: req.meta?.tenantId ?? req.flags?.tenant,
        runId: req.meta?.runId ?? req.flags?.runId,
        ttlMs: req.meta?.leaseTtlMs,
      });
      return {
        ok: true,
        data: { lease },
      };
    }
    case 'lease_release': {
      const result = leaseRegistry.releaseLease({
        leaseId: req.meta?.leaseId ?? req.flags?.leaseId ?? '',
        tenantId: req.meta?.tenantId ?? req.flags?.tenant,
        runId: req.meta?.runId ?? req.flags?.runId,
      });
      return {
        ok: true,
        data: result,
      };
    }
    default:
      return null;
  }
}
