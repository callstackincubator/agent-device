import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireProcessLock } from '../../utils/process-lock.ts';
import { isProcessAlive, readProcessStartTime } from '../../utils/process-identity.ts';

const RUNNER_LEASE_SCHEMA_VERSION = 1;
const RUNNER_LEASE_LOCK_TIMEOUT_MS = 30_000;
const RUNNER_LEASE_LOCK_POLL_MS = 100;
const RUNNER_LEASE_OWNER_GRACE_MS = 5_000;

export const RUNNER_OWNER_PID = process.pid;
export const RUNNER_OWNER_START_TIME = readProcessStartTime(process.pid);
export const RUNNER_OWNER_TOKEN = buildRunnerOwnerToken(RUNNER_OWNER_PID, RUNNER_OWNER_START_TIME);

export type RunnerLease = {
  schemaVersion: 1;
  deviceId: string;
  ownerToken: string;
  ownerPid: number;
  ownerStartTime: string | null;
  sessionId: string;
  runnerPid: number | null;
  port: number;
  xctestrunPath: string;
  jsonPath: string;
  createdAtMs: number;
};

export type RunnerLeaseState =
  | { type: 'empty' }
  | { type: 'owned'; lease: RunnerLease }
  | { type: 'stale'; lease: RunnerLease }
  | { type: 'busy'; lease: RunnerLease };

export function buildRunnerLease(params: {
  deviceId: string;
  sessionId: string;
  runnerPid: number | undefined;
  port: number;
  xctestrunPath: string;
  jsonPath: string;
}): RunnerLease {
  return {
    schemaVersion: RUNNER_LEASE_SCHEMA_VERSION,
    deviceId: params.deviceId,
    ownerToken: RUNNER_OWNER_TOKEN,
    ownerPid: RUNNER_OWNER_PID,
    ownerStartTime: RUNNER_OWNER_START_TIME,
    sessionId: params.sessionId,
    runnerPid: params.runnerPid ?? null,
    port: params.port,
    xctestrunPath: params.xctestrunPath,
    jsonPath: params.jsonPath,
    createdAtMs: Date.now(),
  };
}

export async function withRunnerLeaseLock<T>(deviceId: string, task: () => Promise<T>): Promise<T> {
  const release = await acquireProcessLock({
    lockDirPath: `${resolveRunnerLeasePath(deviceId)}.lock`,
    owner: {
      pid: RUNNER_OWNER_PID,
      startTime: RUNNER_OWNER_START_TIME,
      acquiredAtMs: Date.now(),
    },
    timeoutMs: RUNNER_LEASE_LOCK_TIMEOUT_MS,
    pollMs: RUNNER_LEASE_LOCK_POLL_MS,
    ownerGraceMs: RUNNER_LEASE_OWNER_GRACE_MS,
    description: `iOS runner lease for ${deviceId}`,
  });
  try {
    return await task();
  } finally {
    await release();
  }
}

export function readRunnerLease(deviceId: string): RunnerLease | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(resolveRunnerLeasePath(deviceId), 'utf8')) as unknown;
    return normalizeRunnerLease(parsed, deviceId);
  } catch {
    return null;
  }
}

export function classifyRunnerLease(lease: RunnerLease | null): RunnerLeaseState {
  if (!lease) return { type: 'empty' };
  if (lease.ownerToken === RUNNER_OWNER_TOKEN) return { type: 'owned', lease };
  return isRunnerLeaseOwnerAlive(lease) ? { type: 'busy', lease } : { type: 'stale', lease };
}

export function writeRunnerLease(lease: RunnerLease): void {
  const leasePath = resolveRunnerLeasePath(lease.deviceId);
  fs.mkdirSync(path.dirname(leasePath), { recursive: true });
  const tmpPath = `${leasePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(lease, null, 2), 'utf8');
  fs.renameSync(tmpPath, leasePath);
}

export function removeRunnerLease(params: {
  deviceId: string;
  ownerToken?: string;
  sessionId?: string;
}): void {
  const lease = readRunnerLease(params.deviceId);
  if (!lease) return;
  if (params.ownerToken && lease.ownerToken !== params.ownerToken) return;
  if (params.sessionId && lease.sessionId !== params.sessionId) return;
  try {
    fs.unlinkSync(resolveRunnerLeasePath(params.deviceId));
  } catch {}
}

export function resolveRunnerLeasePath(deviceId: string): string {
  return path.join(resolveRunnerLeaseRoot(), `${sanitizeLeaseFileName(deviceId)}.json`);
}

function resolveRunnerLeaseRoot(): string {
  const override = process.env.AGENT_DEVICE_IOS_RUNNER_LEASE_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(os.homedir(), '.agent-device', 'ios-runner', 'leases');
}

function normalizeRunnerLease(value: unknown, deviceId: string): RunnerLease | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<RunnerLease>;
  if (raw.schemaVersion !== RUNNER_LEASE_SCHEMA_VERSION) return null;
  if (raw.deviceId !== deviceId) return null;
  const ownerToken = raw.ownerToken;
  const ownerPid = raw.ownerPid;
  const sessionId = raw.sessionId;
  const port = raw.port;
  const runnerPid = raw.runnerPid;
  const xctestrunPath = raw.xctestrunPath;
  const jsonPath = raw.jsonPath;
  const createdAtMs = raw.createdAtMs;
  if (typeof ownerToken !== 'string' || ownerToken.length === 0) return null;
  if (typeof ownerPid !== 'number' || !Number.isInteger(ownerPid) || ownerPid <= 0) return null;
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null;
  if (typeof port !== 'number' || !Number.isInteger(port) || port <= 0) return null;
  if (typeof xctestrunPath !== 'string' || xctestrunPath.length === 0) return null;
  if (typeof jsonPath !== 'string' || jsonPath.length === 0) return null;
  if (typeof createdAtMs !== 'number' || !Number.isFinite(createdAtMs)) return null;
  return {
    schemaVersion: RUNNER_LEASE_SCHEMA_VERSION,
    deviceId: raw.deviceId,
    ownerToken,
    ownerPid,
    ownerStartTime: typeof raw.ownerStartTime === 'string' ? raw.ownerStartTime : null,
    sessionId,
    runnerPid:
      typeof runnerPid === 'number' && Number.isInteger(runnerPid) && runnerPid > 0
        ? runnerPid
        : null,
    port,
    xctestrunPath,
    jsonPath,
    createdAtMs,
  };
}

function isRunnerLeaseOwnerAlive(lease: RunnerLease): boolean {
  if (!isProcessAlive(lease.ownerPid)) return false;
  if (lease.ownerStartTime) {
    return readProcessStartTime(lease.ownerPid) === lease.ownerStartTime;
  }
  return true;
}

function buildRunnerOwnerToken(pid: number, startTime: string | null): string {
  const hash = crypto.createHash('sha256');
  hash.update(String(pid));
  hash.update('\0');
  hash.update(startTime ?? 'unknown-start');
  return `owner-${pid}-${hash.digest('hex').slice(0, 8)}`;
}

function sanitizeLeaseFileName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, '-') || 'unknown-device';
}
