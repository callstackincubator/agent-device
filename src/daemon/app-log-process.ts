import fs from 'node:fs';
import path from 'node:path';
import { readProcessCommand, readProcessStartTime } from '../utils/process-identity.ts';

export const APP_LOG_PID_FILENAME = 'app-log.pid';

export type AppLogResult = {
  backend: 'ios-simulator' | 'ios-device' | 'android' | 'macos';
  getState: () => 'active' | 'failed';
  startedAt: number;
  stop: () => Promise<void>;
  wait: Promise<{ stdout: string; stderr: string; exitCode: number }>;
};

type StoredAppLogProcessMeta = {
  pid: number;
  startTime?: string;
  command?: string;
};

function parsePidFile(raw: string): StoredAppLogProcessMeta | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return { pid: Number.parseInt(trimmed, 10) };
  }
  try {
    const parsed = JSON.parse(trimmed) as StoredAppLogProcessMeta;
    if (!Number.isInteger(parsed.pid) || parsed.pid <= 0) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isManagedAppLogCommand(command: string): boolean {
  const normalized = command.toLowerCase().replaceAll('\\', '/');
  return (
    normalized.includes('log stream') ||
    normalized.includes('logcat') ||
    normalized.includes('devicectl device log stream')
  );
}

function shouldTerminateStoredProcess(meta: StoredAppLogProcessMeta): boolean {
  const currentStartTime = readProcessStartTime(meta.pid);
  if (!currentStartTime) return false;
  if (meta.startTime && currentStartTime !== meta.startTime) return false;
  const currentCommand = readProcessCommand(meta.pid);
  if (!currentCommand || !isManagedAppLogCommand(currentCommand)) return false;
  if (meta.command && currentCommand !== meta.command) return false;
  return true;
}

export function writePidFile(pidPath: string | undefined, pid: number): void {
  if (!pidPath) return;
  const dir = path.dirname(pidPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const metadata: StoredAppLogProcessMeta = {
    pid,
    startTime: readProcessStartTime(pid) ?? undefined,
    command: readProcessCommand(pid) ?? undefined,
  };
  fs.writeFileSync(pidPath, `${JSON.stringify(metadata)}\n`);
}

export function clearPidFile(pidPath: string | undefined): void {
  if (!pidPath || !fs.existsSync(pidPath)) return;
  try {
    fs.unlinkSync(pidPath);
  } catch {
    // best-effort cleanup
  }
}

export function cleanupStaleAppLogProcesses(sessionsDir: string): void {
  if (!fs.existsSync(sessionsDir)) return;
  const entries = fs.readdirSync(sessionsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pidPath = path.join(sessionsDir, entry.name, APP_LOG_PID_FILENAME);
    if (!fs.existsSync(pidPath)) continue;
    try {
      const meta = parsePidFile(fs.readFileSync(pidPath, 'utf8'));
      if (meta && shouldTerminateStoredProcess(meta)) {
        try {
          process.kill(meta.pid, 'SIGTERM');
        } catch {
          // process already gone
        }
      }
    } catch {
      // ignore malformed pid files
    } finally {
      clearPidFile(pidPath);
    }
  }
}
