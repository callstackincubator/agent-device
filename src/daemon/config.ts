import os from 'node:os';
import path from 'node:path';

export type DaemonServerMode = 'socket' | 'http' | 'dual';
export type DaemonTransportPreference = 'auto' | 'socket' | 'http';
export type SessionIsolationMode = 'none' | 'tenant';

export type DaemonPaths = {
  baseDir: string;
  infoPath: string;
  lockPath: string;
  logPath: string;
  sessionsDir: string;
};

export function resolveDaemonPaths(stateDir: string | undefined): DaemonPaths {
  const baseDir = resolveStateDir(stateDir);
  return {
    baseDir,
    infoPath: path.join(baseDir, 'daemon.json'),
    lockPath: path.join(baseDir, 'daemon.lock'),
    logPath: path.join(baseDir, 'daemon.log'),
    sessionsDir: path.join(baseDir, 'sessions'),
  };
}

export function resolveStateDir(raw: string | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) {
    return path.join(os.homedir(), '.agent-device');
  }
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(value);
}

export function resolveDaemonServerMode(raw: string | undefined): DaemonServerMode {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'http') return 'http';
  if (normalized === 'dual') return 'dual';
  return 'socket';
}

export function resolveDaemonTransportPreference(raw: string | undefined): DaemonTransportPreference {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'auto') return 'auto';
  if (normalized === 'socket') return 'socket';
  if (normalized === 'http') return 'http';
  if (normalized === 'dual') return 'auto';
  return 'auto';
}

export function resolveSessionIsolationMode(raw: string | undefined): SessionIsolationMode {
  const normalized = (raw ?? '').trim().toLowerCase();
  if (normalized === 'tenant') return 'tenant';
  return 'none';
}

export function normalizeTenantId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  if (!/^[a-zA-Z0-9._-]{1,128}$/.test(value)) return undefined;
  return value;
}
