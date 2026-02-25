import test from 'node:test';
import assert from 'node:assert/strict';
import { LeaseRegistry } from '../lease-registry.ts';

test('allocateLease creates lease and enforces tenant/run validation', () => {
  const registry = new LeaseRegistry();
  const lease = registry.allocateLease({
    tenantId: 'tenant-a',
    runId: 'run-1',
  });
  assert.equal(lease.tenantId, 'tenant-a');
  assert.equal(lease.runId, 'run-1');
  assert.equal(lease.backend, 'ios-simulator');
  assert.ok(lease.leaseId.length >= 16);

  assert.throws(
    () => registry.allocateLease({ tenantId: 'bad tenant', runId: 'run-2' }),
    /Invalid tenant id/,
  );
  assert.throws(
    () => registry.allocateLease({ tenantId: 'tenant-a', runId: 'bad run id' }),
    /Invalid run id/,
  );
});

test('allocateLease is idempotent per tenant/run/backend and refreshes expiry', () => {
  let now = 1_000;
  const registry = new LeaseRegistry({
    now: () => now,
    defaultLeaseTtlMs: 10_000,
  });
  const first = registry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });
  now = 2_000;
  const second = registry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });
  assert.equal(second.leaseId, first.leaseId);
  assert.equal(second.heartbeatAt, 2_000);
  assert.equal(second.expiresAt, 12_000);
});

test('heartbeatLease extends active lease and releaseLease is idempotent', () => {
  let now = 1_000;
  const registry = new LeaseRegistry({
    now: () => now,
    defaultLeaseTtlMs: 10_000,
  });
  const lease = registry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });
  now = 5_000;
  const heartbeat = registry.heartbeatLease({ leaseId: lease.leaseId, ttlMs: 20_000 });
  assert.equal(heartbeat.heartbeatAt, 5_000);
  assert.equal(heartbeat.expiresAt, 25_000);

  const released = registry.releaseLease({ leaseId: lease.leaseId });
  assert.deepEqual(released, { released: true });
  const releasedAgain = registry.releaseLease({ leaseId: lease.leaseId });
  assert.deepEqual(releasedAgain, { released: false });
});

test('heartbeat/release enforce optional tenant/run scope matching', () => {
  const registry = new LeaseRegistry();
  const lease = registry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });

  assert.throws(
    () => registry.heartbeatLease({ leaseId: lease.leaseId, tenantId: 'tenant-b' }),
    /Lease does not match tenant\/run scope/,
  );
  assert.throws(
    () => registry.releaseLease({ leaseId: lease.leaseId, runId: 'run-2' }),
    /Lease does not match tenant\/run scope/,
  );
});

test('expired leases are cleaned before admission checks', () => {
  let now = 1_000;
  const registry = new LeaseRegistry({
    now: () => now,
    defaultLeaseTtlMs: 5_000,
  });
  const lease = registry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });
  now = 7_000;
  assert.throws(
    () =>
      registry.assertLeaseAdmission({
        tenantId: 'tenant-a',
        runId: 'run-1',
        leaseId: lease.leaseId,
      }),
    /Lease is not active/,
  );
});

test('capacity limits reject additional simulator leases', () => {
  const registry = new LeaseRegistry({
    maxActiveSimulatorLeases: 1,
  });
  registry.allocateLease({ tenantId: 'tenant-a', runId: 'run-1' });
  assert.throws(
    () => registry.allocateLease({ tenantId: 'tenant-b', runId: 'run-2' }),
    /No simulator lease capacity available/,
  );
});
