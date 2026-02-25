import crypto from 'node:crypto';
import { AppError } from '../utils/errors.ts';
import { normalizeTenantId } from './config.ts';

export type LeaseBackend = 'ios-simulator';

export type SimulatorLease = {
  leaseId: string;
  tenantId: string;
  runId: string;
  backend: LeaseBackend;
  createdAt: number;
  heartbeatAt: number;
  expiresAt: number;
};

export type LeaseRegistryOptions = {
  maxActiveSimulatorLeases?: number;
  defaultLeaseTtlMs?: number;
  minLeaseTtlMs?: number;
  maxLeaseTtlMs?: number;
  now?: () => number;
};

export type AllocateLeaseRequest = {
  tenantId: string;
  runId: string;
  backend?: LeaseBackend;
  ttlMs?: number;
};

export type HeartbeatLeaseRequest = {
  leaseId: string;
  tenantId?: string;
  runId?: string;
  ttlMs?: number;
};

export type ReleaseLeaseRequest = {
  leaseId: string;
  tenantId?: string;
  runId?: string;
};

export type AdmissionRequest = {
  tenantId: string | undefined;
  runId: string | undefined;
  leaseId: string | undefined;
  backend?: LeaseBackend;
};

const DEFAULT_LEASE_TTL_MS = 60_000;
const MIN_LEASE_TTL_MS = 5_000;
const MAX_LEASE_TTL_MS = 10 * 60_000;

function normalizeRunId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(value)) return undefined;
  return value;
}

function normalizeLeaseId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^[a-f0-9]{16,128}$/i.test(value)) return undefined;
  return value.toLowerCase();
}

function normalizeLeaseBackend(raw: string | undefined): LeaseBackend {
  const value = (raw ?? '').trim().toLowerCase();
  if (!value || value === 'ios-simulator') return 'ios-simulator';
  throw new AppError('INVALID_ARGS', `Unsupported lease backend: ${raw ?? ''}`);
}

export class LeaseRegistry {
  private readonly leases = new Map<string, SimulatorLease>();
  private readonly runBindings = new Map<string, string>();
  private readonly maxActiveSimulatorLeases: number;
  private readonly defaultLeaseTtlMs: number;
  private readonly minLeaseTtlMs: number;
  private readonly maxLeaseTtlMs: number;
  private readonly now: () => number;

  constructor(options: LeaseRegistryOptions = {}) {
    this.maxActiveSimulatorLeases = Number.isInteger(options.maxActiveSimulatorLeases)
      ? Math.max(0, Number(options.maxActiveSimulatorLeases))
      : 0;
    this.defaultLeaseTtlMs = Number.isInteger(options.defaultLeaseTtlMs)
      ? Math.max(1, Number(options.defaultLeaseTtlMs))
      : DEFAULT_LEASE_TTL_MS;
    this.minLeaseTtlMs = Number.isInteger(options.minLeaseTtlMs)
      ? Math.max(1, Number(options.minLeaseTtlMs))
      : MIN_LEASE_TTL_MS;
    this.maxLeaseTtlMs = Number.isInteger(options.maxLeaseTtlMs)
      ? Math.max(this.minLeaseTtlMs, Number(options.maxLeaseTtlMs))
      : MAX_LEASE_TTL_MS;
    this.now = options.now ?? (() => Date.now());
  }

  allocateLease(request: AllocateLeaseRequest): SimulatorLease {
    const backend = normalizeLeaseBackend(request.backend);
    const tenantId = normalizeTenantId(request.tenantId);
    if (!tenantId) {
      throw new AppError('INVALID_ARGS', 'Invalid tenant id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.');
    }
    const runId = normalizeRunId(request.runId);
    if (!runId) {
      throw new AppError('INVALID_ARGS', 'Invalid run id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.');
    }
    this.cleanupExpiredLeases();
    const leaseTtlMs = this.resolveLeaseTtlMs(request.ttlMs);
    const bindingKey = this.bindingKey(tenantId, runId, backend);
    const existingId = this.runBindings.get(bindingKey);
    if (existingId) {
      const existingLease = this.leases.get(existingId);
      if (existingLease) {
        return this.refreshLease(existingLease, leaseTtlMs);
      }
      this.runBindings.delete(bindingKey);
    }
    this.enforceCapacity(backend);
    const now = this.now();
    const lease: SimulatorLease = {
      leaseId: crypto.randomBytes(16).toString('hex'),
      tenantId,
      runId,
      backend,
      createdAt: now,
      heartbeatAt: now,
      expiresAt: now + leaseTtlMs,
    };
    this.leases.set(lease.leaseId, lease);
    this.runBindings.set(bindingKey, lease.leaseId);
    return { ...lease };
  }

  heartbeatLease(request: HeartbeatLeaseRequest): SimulatorLease {
    const leaseId = normalizeLeaseId(request.leaseId);
    if (!leaseId) {
      throw new AppError('INVALID_ARGS', 'Invalid lease id.');
    }
    this.cleanupExpiredLeases();
    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new AppError('UNAUTHORIZED', 'Lease is not active', {
        reason: 'LEASE_NOT_FOUND',
      });
    }
    this.assertOptionalScopeMatch(lease, request.tenantId, request.runId);
    const leaseTtlMs = this.resolveLeaseTtlMs(request.ttlMs);
    return this.refreshLease(lease, leaseTtlMs);
  }

  releaseLease(request: ReleaseLeaseRequest): { released: boolean } {
    const leaseId = normalizeLeaseId(request.leaseId);
    if (!leaseId) {
      throw new AppError('INVALID_ARGS', 'Invalid lease id.');
    }
    this.cleanupExpiredLeases();
    const lease = this.leases.get(leaseId);
    if (!lease) {
      return { released: false };
    }
    this.assertOptionalScopeMatch(lease, request.tenantId, request.runId);
    this.leases.delete(leaseId);
    this.runBindings.delete(this.bindingKey(lease.tenantId, lease.runId, lease.backend));
    return { released: true };
  }

  assertLeaseAdmission(request: AdmissionRequest): void {
    const backend = normalizeLeaseBackend(request.backend);
    const tenantId = normalizeTenantId(request.tenantId);
    if (!tenantId) {
      throw new AppError('INVALID_ARGS', 'tenant isolation requires tenant id.');
    }
    const runId = normalizeRunId(request.runId);
    if (!runId) {
      throw new AppError('INVALID_ARGS', 'tenant isolation requires run id.');
    }
    const leaseId = normalizeLeaseId(request.leaseId);
    if (!leaseId) {
      throw new AppError('INVALID_ARGS', 'tenant isolation requires lease id.');
    }
    this.cleanupExpiredLeases();
    const lease = this.leases.get(leaseId);
    if (!lease) {
      throw new AppError('UNAUTHORIZED', 'Lease is not active', {
        reason: 'LEASE_NOT_FOUND',
      });
    }
    if (lease.backend !== backend || lease.tenantId !== tenantId || lease.runId !== runId) {
      throw new AppError('UNAUTHORIZED', 'Lease does not match tenant/run scope', {
        reason: 'LEASE_SCOPE_MISMATCH',
      });
    }
  }

  listActiveLeases(): SimulatorLease[] {
    this.cleanupExpiredLeases();
    return Array.from(this.leases.values()).map((entry) => ({ ...entry }));
  }

  private cleanupExpiredLeases(): void {
    const now = this.now();
    for (const lease of this.leases.values()) {
      if (lease.expiresAt > now) continue;
      this.leases.delete(lease.leaseId);
      this.runBindings.delete(this.bindingKey(lease.tenantId, lease.runId, lease.backend));
    }
  }

  private enforceCapacity(backend: LeaseBackend): void {
    if (backend !== 'ios-simulator') return;
    if (this.maxActiveSimulatorLeases <= 0) return;
    const activeSimulatorLeases = Array.from(this.leases.values())
      .filter((lease) => lease.backend === 'ios-simulator')
      .length;
    if (activeSimulatorLeases < this.maxActiveSimulatorLeases) return;
    throw new AppError('COMMAND_FAILED', 'No simulator lease capacity available', {
      reason: 'LEASE_CAPACITY_EXCEEDED',
      activeLeases: activeSimulatorLeases,
      maxActiveLeases: this.maxActiveSimulatorLeases,
      backend,
      hint: 'Retry after releasing another simulator lease.',
    });
  }

  private resolveLeaseTtlMs(raw: number | undefined): number {
    if (!Number.isInteger(raw)) return this.defaultLeaseTtlMs;
    const value = Number(raw);
    if (value < this.minLeaseTtlMs || value > this.maxLeaseTtlMs) {
      throw new AppError(
        'INVALID_ARGS',
        `Lease ttlMs must be between ${this.minLeaseTtlMs} and ${this.maxLeaseTtlMs}.`,
      );
    }
    return value;
  }

  private refreshLease(lease: SimulatorLease, ttlMs: number): SimulatorLease {
    const now = this.now();
    const updated: SimulatorLease = {
      ...lease,
      heartbeatAt: now,
      expiresAt: now + ttlMs,
    };
    this.leases.set(updated.leaseId, updated);
    this.runBindings.set(this.bindingKey(updated.tenantId, updated.runId, updated.backend), updated.leaseId);
    return { ...updated };
  }

  private bindingKey(tenantId: string, runId: string, backend: LeaseBackend): string {
    return `${tenantId}:${runId}:${backend}`;
  }

  private assertOptionalScopeMatch(
    lease: SimulatorLease,
    tenantRaw: string | undefined,
    runRaw: string | undefined,
  ): void {
    const tenantId = normalizeTenantId(tenantRaw);
    const runId = normalizeRunId(runRaw);
    if (tenantRaw && !tenantId) {
      throw new AppError('INVALID_ARGS', 'Invalid tenant id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.');
    }
    if (runRaw && !runId) {
      throw new AppError('INVALID_ARGS', 'Invalid run id. Use 1-128 chars: letters, numbers, dot, underscore, hyphen.');
    }
    if (tenantId && lease.tenantId !== tenantId) {
      throw new AppError('UNAUTHORIZED', 'Lease does not match tenant/run scope', {
        reason: 'LEASE_SCOPE_MISMATCH',
      });
    }
    if (runId && lease.runId !== runId) {
      throw new AppError('UNAUTHORIZED', 'Lease does not match tenant/run scope', {
        reason: 'LEASE_SCOPE_MISMATCH',
      });
    }
  }
}
